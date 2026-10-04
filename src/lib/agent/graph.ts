import { ChatVertexAI } from '@langchain/google-vertexai';
import { StateGraph, MessagesAnnotation, START, END, Annotation } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { getDb } from '../db';
import { create_recovery_order, createOrderInternal } from './tools';
import { Proposal, proposalSchema, validateProposal, ValidatedDecision, detectEscalation, checkMessageAmounts, CustomerContext, sanitizeReply } from './guardrails';
import { formatDollars } from '../money';

const GraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  customerId: Annotation<string>(),
  billingEventId: Annotation<string>(),
  customerContext: Annotation<CustomerContext | null>({ reducer: (a, b) => b !== undefined ? b : a, default: () => null }),
  activeOfferId: Annotation<string | null>({ reducer: (a, b) => b !== undefined ? b : a, default: () => null }),
  intent: Annotation<string | null>({ reducer: (a, b) => b !== undefined ? b : a, default: () => null }),
  rawProposal: Annotation<Proposal | null>({ reducer: (a, b) => b !== undefined ? b : a, default: () => null }),
  decision: Annotation<ValidatedDecision | null>({ reducer: (a, b) => b !== undefined ? b : a, default: () => null })
});

function getLlm(modelId: string) {
  const location = process.env.GOOGLE_CLOUD_LOCATION || 'global';
  const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;
  return new ChatVertexAI({
    ...(credentialsJson ? { authOptions: { credentials: JSON.parse(credentialsJson) } } : {}),
    model: modelId,
    location,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    ...(location === 'global' ? { endpoint: 'aiplatform.googleapis.com' } : {}),
    maxRetries: 0
  } as any);
}

async function load_context(state: typeof GraphState.State) {
  const db = getDb();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(state.customerId) as any;
  const context: CustomerContext = {
    plan_name: customer.plan_name,
    plan_price_cents: customer.plan_price_cents,
    usage_percent: customer.usage_percent
  };
  const offer = db.prepare(`SELECT id FROM offers WHERE customer_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`).get(state.customerId) as any;
  return { customerContext: context, activeOfferId: offer ? offer.id : null };
}

async function decide(state: typeof GraphState.State, config: any) {
  // LLM budget is checked once per graph run by the calling route (see src/lib/rate-limit.ts).

  const modelId = config?.configurable?.modelId || process.env.LLM_MODEL;
  
  const llm = getLlm(modelId);
  const z = require('zod').z; const structuredLlm = llm.withStructuredOutput(z.object({ intent: z.enum(['negotiate', 'accept', 'decline', 'cancel', 'neutral', 'escalate']), proposal: proposalSchema }), { name: 'decision' });
  
  const pushbacks = state.messages.filter((m: any) => m._getType() === 'human' && m.content !== 'Hello, I see my payment failed.').length;
  const lower_tier_available = pushbacks < 2 && (state.customerContext?.usage_percent || 100) < 60;
  const sysMsg = `You are a billing retention agent.
Customer context: Plan ${state.customerContext?.plan_name} at ${formatDollars(state.customerContext?.plan_price_cents ?? 0)}. Usage: ${state.customerContext?.usage_percent}%.
Active Offer ID: ${state.activeOfferId || 'None'}.
  Lower discount tier available if customer pushes back: ${lower_tier_available}

Rules:
If usage_percent < 60, prefer partial_credit, downgrade (if a lower plan exists) or pause before plain retry.
If usage_percent >= 60, retry only.
`;
  
  const start = Date.now();
  const result = await structuredLlm.invoke([{ role: 'system', content: sysMsg }, ...state.messages]);
  if (process.env.DEBUG_TIMING === '1') console.log(`[Timer] decide: ${Date.now() - start}ms`);
  return { intent: result.intent, rawProposal: result.proposal };
}

async function validate_guardrails(state: typeof GraphState.State) {
  const startNode = Date.now();
  if (!state.rawProposal) return state; 
  
  const db = getDb();
  const lastMsg = state.messages[state.messages.length - 1].content as string;
  const escalations = detectEscalation(lastMsg);
  
  const pushbacks = state.messages.filter((m: any) => m._getType() === 'human' && m.content !== 'Hello, I see my payment failed.').length;
  const cancelCount = state.messages.filter((m: any) => m._getType() === 'human' && /cancel|close|delete|terminate/i.test(m.content as string)).length;
  const validated = validateProposal(state.rawProposal!, state.customerContext!, { escalationKeywords: escalations, intent: state.intent || undefined, pushbacks, cancelCount });
  
  if (state.intent === 'accept' && state.activeOfferId) {
    db.prepare(`UPDATE offers SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`).run(state.activeOfferId);
    
    const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(state.activeOfferId) as any;
    if (offer && offer.amount_cents > 0 && !offer.paypal_order_id) {
      await createOrderInternal(offer.id);
    }
  } else if (state.intent === 'decline' && state.activeOfferId) {
    db.prepare(`UPDATE offers SET status = 'declined' WHERE id = ? AND status = 'pending'`).run(state.activeOfferId);
  }
  
  return { decision: validated };
}

async function compose_message(state: typeof GraphState.State, config: any) {
  const startNode = Date.now();
  const modelId = config?.configurable?.modelId || process.env.LLM_MODEL;
  
  const llm = getLlm(modelId);
  const sysMsg = `You are a billing retention agent.
Intent: ${state.intent}. Action: ${state.decision?.action}.
DO NOT include any links or URLs.
\n${state.decision?.action === 'pause' || state.decision?.action === 'escalate' ? '' : `You MUST explicitly state the original plan price (${formatDollars(state.customerContext?.plan_price_cents || 0)}) and the new final amount (${state.decision?.final_amount_cents ? formatDollars(state.decision.final_amount_cents) : formatDollars(state.customerContext?.plan_price_cents || 0)}) in your message.`}
Mention the customer's usage percentage (${state.customerContext?.usage_percent}%).
If making an offer, ask "Would you like to proceed?" and DO NOT mention a checkout button.
If the customer accepted (intent=accept), tell them a checkout button is provided below (except for 'pause').
Compose a polite response to the customer based on the action. If escalating, tell them exactly: "Your account has been flagged for our billing team, and a specialist will follow up with you by email shortly."`;

  let response = await llm.invoke([{ role: 'system', content: sysMsg }, ...state.messages]);
  let finalMessages = state.messages.concat([response]);

  let lastMsgRaw = finalMessages[finalMessages.length - 1].content as string;
  let lastMsg = sanitizeReply(lastMsgRaw);

  const required = state.decision?.final_amount_cents ?? null;
  const allowed = state.customerContext?.plan_price_cents ? [state.customerContext.plan_price_cents] : [];
  const pushbacks = state.messages.filter((m: any) => m._getType() === 'human' && m.content !== 'Hello, I see my payment failed.').length;
  const lower_tier_available = pushbacks < 2 && (state.customerContext?.usage_percent || 100) < 60;
  let { ok, reason } = checkMessageAmounts(lastMsg, required, allowed);
  if (ok && lower_tier_available && /(lowest|unable to offer|can\'t go lower|cannot go lower)/i.test(lastMsg)) {
    ok = false;
    reason = 'claimed lowest when lower tier exists';
  }

  // LOGGING FOR USER REQUEST
  const db = getDb();
  const msgCount = db.prepare('SELECT COUNT(*) as c FROM conversations WHERE customer_id = ?').get(state.customerId) as { c: number };
  if (msgCount.c === 0) {
  if (process.env.DEBUG_TIMING === '1') {
    console.log(`\n--- DEBUG [${state.customerId}] ---`);
    console.log(`Raw model message: ${lastMsgRaw}`);
    console.log(`Allowed set (cents): ${JSON.stringify(allowed)}. Required (cents): ${required}`);
    console.log(`checkMessageAmounts result: ok=${ok}, reason=${reason}`);
  }
  }

  if (state.intent === 'escalate' || state.decision?.action === 'escalate') {
    db.prepare(`
      INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(`act_${Date.now()}_${Math.random().toString(36).substring(2,7)}`, state.customerId, state.billingEventId, 'escalate', 'Flagged by rules', '{}');
    
    lastMsg = `Your account has been flagged for our billing team, and a specialist will follow up with you by email shortly.`;
  } else {
    const db = getDb();
    const msgCount = db.prepare('SELECT COUNT(*) as c FROM conversations WHERE customer_id = ?').get(state.customerId) as { c: number };
    
    if (msgCount.c === 0 && !ok) {
      // First proactive message! Overwrite using validated code.
      const priceStr = state.customerContext?.plan_price_cents ? formatDollars(state.customerContext.plan_price_cents) : '';
      const usage = state.customerContext?.usage_percent;
      const planName = state.customerContext?.plan_name;
      const action = state.decision?.action;
      const newStr = required ? formatDollars(required) : '';
      
      if (action === 'retry') {
        lastMsg = `Your ${planName} renewal of ${priceStr} didn\'t go through. Would you like to retry the payment at ${priceStr}?`;
      } else if (action === 'pause') {
        lastMsg = `Your ${planName} renewal for ${priceStr} failed. Because your usage was only ${usage}%, your subscription will be paused with no charge. Please confirm if you want to proceed.`;
      } else {
        lastMsg = `I can\'t go that low. The best I can offer right now is ${newStr}. Would you like to proceed?`;
      }
    } else if (msgCount.c > 0 && !ok) {
      const priceStr = state.customerContext?.plan_price_cents ? formatDollars(state.customerContext.plan_price_cents) : '';
      const newStr = required ? formatDollars(required) : '';
      if (state.intent === 'accept') {
        if (state.decision?.action === 'pause') {
          lastMsg = `Your subscription pause is confirmed.`;
        } else {
          lastMsg = `Your amount of ${newStr} is confirmed. A PayPal button is below.`;
        }
      } else {
        if (state.decision?.action === 'retry') {
          lastMsg = `Your ${state.customerContext?.plan_name} renewal of ${priceStr} didn\'t go through. Would you like to retry the payment at ${priceStr}?`;
        } else if (state.decision?.action === 'pause') {
          lastMsg = `Your subscription will be paused with no charge. Please confirm if you want to proceed.`;
        } else {
          lastMsg = `I can\'t go that low. The best I can offer right now is ${newStr}. Would you like to proceed?`;
        }
      }
    }
  }

  if (msgCount.c === 0 && process.env.DEBUG_TIMING === '1') {
    console.log(`Stored message: ${lastMsg}`);
    console.log(`------------------------------\n`);
  }

  finalMessages[finalMessages.length - 1].content = lastMsg;
  return { messages: finalMessages };
}

async function persist(state: typeof GraphState.State) {
  const db = getDb();
  if (state.intent !== 'accept' && state.decision?.creates_offer) {
     db.prepare(`UPDATE offers SET status = 'superseded' WHERE customer_id = ? AND status IN ('pending', 'accepted')`).run(state.customerId);
     const newOfferId = `off_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
     const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
     db.prepare(`
       INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, discount_percent, target_plan, expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     `).run(
       newOfferId, state.customerId, state.billingEventId, state.decision.action, 
       state.decision.final_amount_cents, state.decision.discount_percent, 
       state.decision.target_plan, expiresAt, 'pending'
     );
  }
  
  const lastMsg = state.messages[state.messages.length - 1].content as string;
  db.prepare(`INSERT INTO conversations (id, customer_id, role, text, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    state.customerId, 'agent', lastMsg, new Date().toISOString()
  );
  
  return state;
}

export const graph = new StateGraph(GraphState)
  .addNode('load_context', load_context)
  .addNode('decide', decide)
  .addNode('validate_guardrails', validate_guardrails)
  .addNode('compose_message', compose_message)
  .addNode('persist', persist)
  .addEdge(START, 'load_context')
  .addEdge('load_context', 'decide')
  .addEdge('decide', 'validate_guardrails')
  .addEdge('validate_guardrails', 'compose_message')
  .addEdge('compose_message', 'persist')
  .addEdge('persist', END)
  .compile();


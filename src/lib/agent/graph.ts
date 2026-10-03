import { ChatVertexAI } from '@langchain/google-vertexai';
import { StateGraph, MessagesAnnotation, START, END, Annotation } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { getDb } from '../db';
import { create_recovery_order, createOrderInternal } from './tools';
import { Proposal, proposalSchema, validateProposal, ValidatedDecision, detectEscalation, checkMessageAmounts, CustomerContext } from './guardrails';
import { formatDollars } from '../money';

const GraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  customerId: Annotation<string>(),
  billingEventId: Annotation<string>(),
  customerContext: Annotation<CustomerContext | null>({ reducer: (a, b) => b !== undefined ? b : a, default: () => null }),
  activeOfferId: Annotation<string | null>({ reducer: (a, b) => b !== undefined ? b : a, default: () => null }),
  intent: Annotation<string | null>({ reducer: (a, b) => b !== undefined ? b : a, default: () => null }),
  decision: Annotation<ValidatedDecision | null>({ reducer: (a, b) => b !== undefined ? b : a, default: () => null })
});

function getLlm(modelId: string) {
  const location = process.env.GOOGLE_CLOUD_LOCATION || 'global';
  return new ChatVertexAI({
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
  const modelId = config?.configurable?.modelId || process.env.LLM_MODEL;
  
  const llm = getLlm(modelId);
  const z = require('zod').z; const structuredLlm = llm.withStructuredOutput(z.object({ intent: z.enum(['negotiate', 'accept', 'decline', 'neutral', 'escalate']), proposal: proposalSchema }), { name: 'decision' });
  
  const sysMsg = `You are a billing retention agent.
Customer context: Plan ${state.customerContext?.plan_name} at ${formatDollars(state.customerContext?.plan_price_cents ?? 0)}. Usage: ${state.customerContext?.usage_percent}%.
Active Offer ID: ${state.activeOfferId || 'None'}.

Rules:
If usage_percent < 60, prefer partial_credit, downgrade (if a lower plan exists) or pause before plain retry.
If usage_percent >= 60, retry only.
`;
  
  const result = await structuredLlm.invoke([{ role: 'system', content: sysMsg }, ...state.messages]);
  return { intent: result.intent, decision: result.proposal };
}

async function validate_guardrails(state: typeof GraphState.State) {
  if (!state.decision) return state; 
  
  const db = getDb();
  const lastMsg = state.messages[state.messages.length - 1].content as string;
  const escalations = detectEscalation(lastMsg);
  
  const validated = validateProposal(state.decision as Proposal, state.customerContext!, { escalationKeywords: escalations });
  
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
  const modelId = config?.configurable?.modelId || process.env.LLM_MODEL;
  
  const llm = getLlm(modelId);
  const sysMsg = `You are a billing retention agent.
Intent: ${state.intent}. Action: ${state.decision?.action}.
DO NOT include any links or URLs. Tell the customer a checkout button is provided below (except for 'pause').
Compose a polite response to the customer based on the action.`;

  const llmWithTools = llm.bindTools([create_recovery_order]);
  let response = await llmWithTools.invoke([{ role: 'system', content: sysMsg }, ...state.messages]);
  let finalMessages = state.messages.concat([response]);

  if (response.tool_calls && response.tool_calls.length > 0) {
    const toolNode = new ToolNode([create_recovery_order as any]);
    const toolResult = await toolNode.invoke({ messages: finalMessages }, config);
    finalMessages = toolResult.messages;
    response = await llm.invoke([{ role: 'system', content: sysMsg }, ...finalMessages]);
    finalMessages = finalMessages.concat([response]);
  }

  let lastMsgRaw = finalMessages[finalMessages.length - 1].content as string;
  let lastMsg = lastMsgRaw.replace(/https?:\/\/[^\s]+/g, '').trim();

  const required = state.decision?.final_amount_cents ?? null;
  const allowed = state.customerContext?.plan_price_cents ? [state.customerContext.plan_price_cents] : [];
  const { ok } = checkMessageAmounts(lastMsg, required, allowed);
  
  if (!ok) {
    const priceStr = state.customerContext?.plan_price_cents ? formatDollars(state.customerContext.plan_price_cents) : '';
    const newStr = required ? formatDollars(required) : '';
    if (state.decision?.action === 'retry') {
      lastMsg = `Your payment failed. Your plan stays at ${priceStr}. No discount available. A PayPal button is below.`;
    } else if (state.decision?.action === 'pause') {
      lastMsg = `Your subscription will be paused with no charge. Please confirm if you want to proceed.`;
    } else if (state.decision?.action === 'escalate') {
      lastMsg = `A human will follow up.`;
    } else {
      lastMsg = `We can offer a new amount of ${newStr}. A PayPal button is below.`;
    }
  }

  finalMessages[finalMessages.length - 1].content = lastMsg;
  return { messages: finalMessages };
}

async function persist(state: typeof GraphState.State) {
  const db = getDb();
  if (state.decision?.creates_offer) {
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

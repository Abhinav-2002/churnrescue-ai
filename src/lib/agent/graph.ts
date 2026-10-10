import { ChatVertexAI } from '@langchain/google-vertexai';
import { StateGraph, MessagesAnnotation, START, END, Annotation } from '@langchain/langgraph';
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
  decision: Annotation<ValidatedDecision | null>({ reducer: (a, b) => b !== undefined ? b : a, default: () => null }),
  ladderStep: Annotation<number | null>({ reducer: (a, b) => b !== undefined ? b : a, default: () => null })
});

import { getLlm } from './llm';

export function nextLadderStep(previousStep: number | null, intent: string): number {
  if (previousStep === null) return 0;
  if (intent === 'negotiate') return Math.min(previousStep + 1, 2);
  return previousStep;
}

export const LADDER_PERCENTS = [20, 35, 50];

function getPreviousLadderStep(customerId: string, billingEventId: string): number | null {
  const row = getDb().prepare(
    `SELECT MAX(ladder_step) as ladder_step FROM offers WHERE customer_id = ? AND billing_event_id = ? AND kind = 'partial_credit'`
  ).get(customerId, billingEventId) as { ladder_step: number | null } | undefined;
  return row && row.ladder_step !== null ? row.ladder_step : null;
}

async function load_context(state: typeof GraphState.State) {
  const db = getDb();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(state.customerId) as any;
  const context: CustomerContext = {
    plan_name: customer.plan_name,
    plan_price_cents: customer.plan_price_cents,
    usage_percent: customer.usage_percent
  };
  const offer = db.prepare(`SELECT id FROM offers WHERE customer_id = ? AND status = 'pending' ORDER BY rowid DESC LIMIT 1`).get(state.customerId) as any;
  return { customerContext: context, activeOfferId: offer ? offer.id : null };
}

async function decide(state: typeof GraphState.State, config: any) {
  const modelId = config?.configurable?.modelId || process.env.LLM_MODEL;

  const llm = getLlm(modelId);
  const z = require('zod').z;
  const structuredLlm = llm.withStructuredOutput(
    z.object({
      intent: z.enum(['negotiate', 'accept', 'decline', 'cancel', 'neutral', 'escalate']),
      proposal: proposalSchema
    }),
    { name: 'decision' }
  );

  const previousLadder = getPreviousLadderStep(state.customerId, state.billingEventId);
  const pushbacks = previousLadder || 0;
  const lower_tier_available = pushbacks < 2 && (state.customerContext?.usage_percent || 100) < 60;

  const sysMsg = `You are a billing retention agent.
Customer context: Plan ${state.customerContext?.plan_name} at ${formatDollars(state.customerContext?.plan_price_cents ?? 0)}. Usage: ${state.customerContext?.usage_percent}%.
Active Offer ID: ${state.activeOfferId || 'None'}.
Lower discount tier available if customer pushes back: ${lower_tier_available}

Rules:
If usage_percent < 60, prefer partial_credit (first offer ≤20% discount), downgrade or pause before plain retry.
If usage_percent >= 60, retry only (no discount). If they want to cancel, mention the full price and the pause option.
Intents: 'cancel' if user wants to cancel, 'decline' if they reject an offer, 'escalate' ONLY if angry/abusive or demanding human/manager/legal.
`;

  const result = await structuredLlm.invoke([{ role: 'system', content: sysMsg }, ...state.messages]);
  return { intent: result.intent, rawProposal: result.proposal };
}

async function validate_guardrails(state: typeof GraphState.State) {
  if (!state.rawProposal) return state;

  const db = getDb();
  const lastMsg = state.messages[state.messages.length - 1].content as string;
  const escalations = detectEscalation(lastMsg);

  const previousLadder = getPreviousLadderStep(state.customerId, state.billingEventId);
  const ladderStep = nextLadderStep(previousLadder, state.intent || 'neutral');

  const cancelCount = state.messages.filter(
    (m: any) => m._getType() === 'human' && /cancel|close|delete|terminate/i.test(m.content as string)
  ).length;

  const previousOffer = db.prepare(`SELECT amount_cents FROM offers WHERE customer_id = ? AND billing_event_id = ? ORDER BY rowid DESC LIMIT 1`).get(state.customerId, state.billingEventId) as any;
  const previousAmountCents = previousOffer ? previousOffer.amount_cents : undefined;

  const validated = validateProposal(
    state.rawProposal!,
    state.customerContext!,
    { escalationKeywords: escalations, intent: state.intent || undefined, pushbacks: ladderStep, cancelCount, previousAmountCents }
  );

  if (state.intent === 'accept' && state.activeOfferId) {
    db.prepare(`UPDATE offers SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`).run(state.activeOfferId);
    const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(state.activeOfferId) as any;
    if (offer && offer.amount_cents > 0 && !offer.paypal_order_id) {
      await createOrderInternal(offer.id);
    }
  } else if (state.intent === 'decline' && state.activeOfferId) {
    db.prepare(`UPDATE offers SET status = 'declined' WHERE id = ? AND status = 'pending'`).run(state.activeOfferId);
  }

  return { decision: validated, ladderStep };
}

async function compose_message(state: typeof GraphState.State, config: any) {
  const modelId = config?.configurable?.modelId || process.env.LLM_MODEL;
  const llm = getLlm(modelId);
  const usage = state.customerContext?.usage_percent ?? 100;
  const priceStr = formatDollars(state.customerContext?.plan_price_cents ?? 0);
  const planName = state.customerContext?.plan_name ?? '';
  const finalAmount = state.decision?.final_amount_cents;
  const newStr = finalAmount ? formatDollars(finalAmount) : '';

  const sysMsg = `You are a billing retention agent.
Intent: ${state.intent}. Action: ${state.decision?.action}.
DO NOT include any links or URLs.
${state.decision?.action === 'pause' || state.decision?.action === 'escalate' ? '' : `You MUST explicitly state the original plan price (${priceStr}) and the new final amount (${finalAmount ? formatDollars(finalAmount) : priceStr}) in your message.`}
Mention the customer's usage percentage (${usage}%).
If making an offer, ask "Would you like to proceed?" and DO NOT mention a checkout button.
If the customer accepted (intent=accept), tell them a checkout button is provided below (except for 'pause').
Compose a polite response to the customer based on the action. If escalating, tell them exactly: "Your account has been flagged for our billing team, and a specialist will follow up with you by email shortly."`;

  let response = await llm.invoke([{ role: 'system', content: sysMsg }, ...state.messages]);
  let finalMessages = state.messages.concat([response]);

  let lastMsgRaw = finalMessages[finalMessages.length - 1].content as string;
  let lastMsg = sanitizeReply(lastMsgRaw);

  const required = state.decision?.final_amount_cents ?? null;
  const allowed = state.customerContext?.plan_price_cents ? [state.customerContext.plan_price_cents] : [];

  const pushbacks = state.ladderStep ?? 0;
  const lower_tier_available = pushbacks < 2 && usage < 60;

  let { ok, reason } = checkMessageAmounts(lastMsg, required, allowed);
  if (ok && lower_tier_available && /(lowest|unable to offer|can't go lower|cannot go lower)/i.test(lastMsg)) {
    ok = false;
    reason = 'claimed lowest when lower tier exists';
  }

  const db = getDb();
  // Is this the very first message in the conversation?
  const msgCountRow = db.prepare('SELECT COUNT(*) as c FROM conversations WHERE customer_id = ?').get(state.customerId) as { c: number };
  const isFirst = msgCountRow.c === 0;

  // What was the last agent message? (for de-duplication)
  const lastAgentRow = db.prepare(`SELECT text FROM conversations WHERE customer_id = ? AND role = 'agent' ORDER BY rowid DESC LIMIT 1`).get(state.customerId) as any;
  const lastAgentText = lastAgentRow?.text ?? null;

  const templateUsed = { used: false, reason: '' };

  if (state.intent === 'escalate' || state.decision?.action === 'escalate') {

    lastMsg = `Your account has been flagged for our billing team, and a specialist will follow up with you by email shortly.`;
    templateUsed.used = true;
    templateUsed.reason = 'escalate override';
  } else if (isFirst && !ok) {
    // First proactive message – model hallucinated or omitted amounts
    const action = state.decision?.action;
    if (action === 'retry') {
      lastMsg = `Your ${planName} renewal of ${priceStr} didn't go through. Would you like to retry the payment at ${priceStr}?`;
    } else if (action === 'pause') {
      // First message must never be a pause for usage < 60 – this branch should not be reached
      // but if it is, fall back to a credit offer message
      lastMsg = `Your ${planName} renewal of ${priceStr} didn't go through. Because you've only used ${usage}% of your plan, we can offer a discounted rate of ${newStr}. Would you like to proceed?`;
    } else {
      // partial_credit / downgrade
      lastMsg = `Your ${planName} renewal of ${priceStr} didn't go through. Because you've only used ${usage}% of your plan, we can offer a new amount of ${newStr}. Would you like to proceed?`;
    }
    templateUsed.used = true;
    templateUsed.reason = `first-message fallback (ok=${ok}, reason=${reason})`;
  } else if (!ok) {
    // Non-first message with bad amounts
    const action = state.decision?.action;
    if (state.intent === 'accept') {
      if (action === 'pause') {
        lastMsg = `Your subscription pause is confirmed.`;
      } else {
        lastMsg = `Your amount of ${newStr} is confirmed. A PayPal button is below.`;
      }
    } else if (action === 'retry') {
      if (state.intent === 'cancel') {
        lastMsg = `Your ${planName} renewal of ${priceStr} didn't go through. Would you like to retry the payment at ${priceStr}, or would you prefer to pause your account?`;
      } else {
        lastMsg = `Your ${planName} renewal of ${priceStr} didn't go through. Would you like to retry the payment at ${priceStr}?`;
      }
    } else if (action === 'pause') {
      lastMsg = `Your subscription will be paused with no charge. Please confirm if you want to proceed.`;
    } else {
      // partial_credit / downgrade — choose template by context
      if (!lower_tier_available) {
        lastMsg = `${newStr} is the best I can offer. Would you like to proceed?`;
      } else if (pushbacks > 0) {
        lastMsg = `I can improve that to ${newStr}. Would you like to proceed?`;
      } else {
        lastMsg = `We can offer a new amount of ${newStr}. Would you like to proceed?`;
      }
    }
    templateUsed.used = true;
    templateUsed.reason = `amount check failed (ok=${ok}, reason=${reason})`;
  } else {
    templateUsed.used = false;
    templateUsed.reason = 'model text passed';
  }

  // Never send the same text twice in a row
  if (lastMsg === lastAgentText && lastMsg !== '') {
    if (usage < 60) {
      lastMsg = lastMsg + ' You can also pause your account if you need more time.';
    } else {
      lastMsg = lastMsg + ' Take your time — we\'re here if you change your mind.';
    }
  }

  if (process.env.DEBUG_TIMING === '1') {
    console.log(`[compose] templateUsed=${templateUsed.used} reason="${templateUsed.reason}" finalMsg="${lastMsg}"`);
  }

  if (state.decision || state.intent === 'escalate') {
    const actionName = state.decision?.action || 'escalate';
    db.prepare(`
      INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(`act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`, state.customerId, state.billingEventId, actionName, state.rawProposal?.reasoning || 'Flagged by rules', JSON.stringify({
      proposed_discount_percent: state.rawProposal?.discount_percent ?? null,
      approved_discount_percent: state.decision?.discount_percent ?? null,
      clamps: state.decision?.clamps ?? [],
      template_used: templateUsed.used,
      template_reason: templateUsed.reason,
      ladder_step: state.ladderStep ?? 0
    }));
  }

  finalMessages[finalMessages.length - 1].content = lastMsg;
  return { messages: finalMessages };
}

async function persist(state: typeof GraphState.State) {
  const db = getDb();
  if (state.intent === 'escalate' || state.decision?.action === 'escalate') {
    db.prepare(`UPDATE offers SET status = 'superseded' WHERE customer_id = ? AND status IN ('pending', 'accepted')`).run(state.customerId);
  } else if (state.intent !== 'accept' && state.decision?.creates_offer) {
    const existing = db.prepare(`SELECT * FROM offers WHERE customer_id = ? AND status IN ('pending', 'accepted') ORDER BY rowid DESC LIMIT 1`).get(state.customerId) as any;
    if (existing && existing.kind === state.decision.action && existing.amount_cents === state.decision.final_amount_cents) {
      // Reuse current offer when kind and amount are unchanged
      state.activeOfferId = existing.id;
    } else {
      db.prepare(`UPDATE offers SET status = 'superseded' WHERE customer_id = ? AND status IN ('pending', 'accepted')`).run(state.customerId);
      const newOfferId = `off_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      db.prepare(`
        INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, discount_percent, target_plan, expires_at, status, ladder_step)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newOfferId, state.customerId, state.billingEventId, state.decision.action,
        state.decision.final_amount_cents, state.decision.discount_percent,
        state.decision.target_plan, expiresAt, 'pending', state.ladderStep || 0
      );
      state.activeOfferId = newOfferId;
    }
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

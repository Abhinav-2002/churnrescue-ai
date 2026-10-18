import { ChatVertexAI } from '@langchain/google-vertexai';
import { StateGraph, MessagesAnnotation, START, END, Annotation } from '@langchain/langgraph';
import { getDb } from '../db';
import { create_recovery_order, createOrderInternal } from './tools';
import { Proposal, proposalSchema, validateProposal, ValidatedDecision, detectEscalation, checkMessageAmounts, CustomerContext, sanitizeReply, mapEscalationSeverity, EscalationReason } from './guardrails';
import { formatDollars } from '../money';
import { nextLowerPlan } from '../plans';

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
    `SELECT MAX(ladder_step) as ladder_step FROM offers WHERE customer_id = ? AND billing_event_id = ? AND kind = 'partial_credit' AND is_sample = 0`
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
  const offer = db.prepare(`SELECT id FROM offers WHERE customer_id = ? AND status IN ('pending', 'accepted') AND is_sample = 0 ORDER BY rowid DESC LIMIT 1`).get(state.customerId) as any;
  return { customerContext: context, activeOfferId: offer ? offer.id : null };
}

async function decide(state: typeof GraphState.State, config: any) {
  const modelId = config?.configurable?.modelId || process.env.LLM_MODEL;

  const llm = getLlm(modelId);
  const z = require('zod').z;
  const structuredLlm = llm.withStructuredOutput(
    z.object({
      intent: z.enum(['negotiate', 'accept', 'decline', 'cancel', 'neutral', 'escalate', 'pause_request', 'question']),
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
Intents: 'negotiate' if user asks for a lower price, counter-offers, or pushes back on price (e.g. "$10 i can afford", "can you make it lower", "still too much"), 'accept' if user agrees or accepts an offer, 'decline' if user rejects or says no without asking for a lower price (e.g. "no thanks", "not interested"), 'cancel' if user wants to cancel, 'pause_request' if user asks to pause/freeze subscription, 'question' if user asks a question about the charge or plan, 'escalate' ONLY if angry/abusive or demanding human/manager/legal.
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

  let pushbacks = ladderStep;
  if ((state.customerContext?.usage_percent || 0) >= 60) {
    const prevActionsRow = db.prepare(
      `SELECT COUNT(*) as c FROM agent_actions WHERE customer_id = ? AND billing_event_id = ? AND action IN ('retry', 'partial_credit', 'escalate') AND is_sample = 0`
    ).get(state.customerId, state.billingEventId) as { c: number } | undefined;
    pushbacks = prevActionsRow ? prevActionsRow.c : 0;
  }

  const cancelCount = state.messages.filter(
    (m: any) => m._getType() === 'human' && /cancel|close|delete|terminate/i.test(m.content as string)
  ).length;

  const previousOffer = db.prepare(`SELECT amount_cents FROM offers WHERE customer_id = ? AND billing_event_id = ? AND is_sample = 0 ORDER BY rowid DESC LIMIT 1`).get(state.customerId, state.billingEventId) as any;
  const previousAmountCents = previousOffer ? previousOffer.amount_cents : undefined;

  const validated = validateProposal(
    state.rawProposal!,
    state.customerContext!,
    { escalationKeywords: escalations, intent: state.intent || undefined, pushbacks, cancelCount, previousAmountCents }
  );

  if (state.intent === 'accept' && state.activeOfferId) {
    db.prepare(`UPDATE offers SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`).run(state.activeOfferId);
    const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(state.activeOfferId) as any;
    if (offer) {
      validated.action = offer.kind;
      validated.final_amount_cents = offer.amount_cents;
      validated.discount_percent = offer.discount_percent;
      validated.target_plan = offer.target_plan;
      if (offer.amount_cents > 0 && !offer.paypal_order_id) {
        await createOrderInternal(offer.id);
      }
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

  let guidance = '';
  if (state.intent === 'escalate' || state.decision?.action === 'escalate') {
    guidance = `Tell the customer exactly: "Your account has been flagged for our billing team, and a specialist will follow up with you by email shortly."`;
  } else if (state.intent === 'decline') {
    guidance = `Acknowledge the customer's refusal politely (e.g. "I understand you don't wish to proceed with this offer.").
Mention the option to pause their subscription if they need more time (mention pause exactly once).
DO NOT ask to retry payment or process any payment. DO NOT state that any payment is due. DO NOT make any new discount offer, and DO NOT mention escalating or contacting a specialist. End politely by letting them know they can pause or reach out anytime.`;
  } else if (state.intent === 'question') {
    guidance = `Explain that this charge is for their ${planName} subscription renewal.
${finalAmount && state.decision?.discount_percent ? `State that their current offer of ${newStr} is still available, or they can pause their subscription. Ask "Would you like to proceed?". DO NOT claim that the original price (${priceStr}) is the new final amount.` : `State that their renewal is ${priceStr} and that they can retry the payment or pause their subscription.`}`;
  } else if (state.decision?.action === 'pause') {
    guidance = `Tell the customer that their subscription can be paused with no charge, and ask them to click Confirm Pause below to proceed. Make clear that their subscription has NOT been paused yet until they confirm. DO NOT claim that you have already processed or paused the account.`;
  } else {
    guidance = `You MUST explicitly state the original plan price (${priceStr}) and the new final amount (${finalAmount ? formatDollars(finalAmount) : priceStr}) in your message.
Mention the customer's usage percentage (${usage}%).
If making an offer, ask "Would you like to proceed?" and DO NOT mention a checkout button.
If the customer accepted (intent=accept), tell them a checkout button is provided below (except for 'pause').`;
  }

  const sysMsg = `You are a billing retention agent.
Intent: ${state.intent}. Action: ${state.decision?.action}.
DO NOT include any links or URLs.
${guidance}
Compose a polite response to the customer based on the action.`;

  let response = await llm.invoke([{ role: 'system', content: sysMsg }, ...state.messages]);
  let finalMessages = state.messages.concat([response]);

  let lastMsgRaw = finalMessages[finalMessages.length - 1].content as string;
  let lastMsg = sanitizeReply(lastMsgRaw);

  const db = getDb();
  const required = state.decision?.final_amount_cents ?? null;
  const prevOffers = db.prepare(`SELECT amount_cents FROM offers WHERE customer_id = ? AND billing_event_id = ? AND is_sample = 0`).all(state.customerId, state.billingEventId) as { amount_cents: number }[];
  const allowed = [
    ...(state.customerContext?.plan_price_cents ? [state.customerContext.plan_price_cents] : []),
    ...prevOffers.map(o => o.amount_cents)
  ];

  const pushbacks = state.ladderStep ?? 0;

  let lower_tier_available = false;
  if (state.decision?.action === 'partial_credit') {
    lower_tier_available = pushbacks < 2 && usage < 60;
  } else if (state.decision?.action === 'downgrade') {
    lower_tier_available = !!nextLowerPlan(state.decision.final_amount_cents || state.customerContext!.plan_price_cents);
  } else {
    lower_tier_available = usage < 60;
  }

  let { ok, reason } = checkMessageAmounts(lastMsg, required, allowed);
  if (ok && lower_tier_available && /(lowest|unable to offer|can't go lower|cannot go lower)/i.test(lastMsg)) {
    ok = false;
    reason = 'claimed lowest when lower tier exists';
  }

  if (ok && state.intent !== 'escalate' && state.decision?.action !== 'escalate') {
    if (/flagged for our billing team|specialist will follow up/i.test(lastMsg)) {
      ok = false;
      reason = 'model hallucinated escalation text when not escalating';
    }
  }

  if (ok && state.intent === 'question') {
    const hasExplanation = /renew|subscription|Starter|plan|charge/i.test(lastMsg);
    const claimsOriginalAsFinal = !!(state.decision?.discount_percent && /(new final amount is|final amount.*?\$\d+)/i.test(lastMsg) && lastMsg.includes(priceStr) && priceStr !== newStr);
    const missingOffer = !!(finalAmount && state.decision?.discount_percent && !lastMsg.includes(newStr));
    const leakedPrompt = /(restate|state that|inform the customer)/i.test(lastMsg);
    if (!hasExplanation || claimsOriginalAsFinal || missingOffer || leakedPrompt) {
      ok = false;
      reason = 'question response failed invariants';
    }
  }

  if (ok && state.intent === 'decline') {
    const demandsRetryOrPayment = /(retry|process(ing)? your payment|payment.*remains due|due)/i.test(lastMsg);
    const pauseCount = (lastMsg.match(/pause/gi) || []).length;
    const isPolite = /understand|no problem|apologize|sorry|certainly|all right|alright|take your time|help/i.test(lastMsg);
    const mentionsEscalate = /specialist|flagged for our billing team|billing team/i.test(lastMsg);
    if (demandsRetryOrPayment || pauseCount !== 1 || !isPolite || mentionsEscalate) {
      ok = false;
      reason = 'decline response failed invariants';
    }
  }

  if (ok && state.decision?.action === 'pause' && !(state.intent === 'accept' && state.activeOfferId)) {
    const claimsAlreadyPaused = /(gone ahead|processed the pause|have paused|already paused|is now paused|has been paused(?!\s+yet))/i.test(lastMsg);
    const asksForConfirmation = /confirm/i.test(lastMsg);
    if (claimsAlreadyPaused || !asksForConfirmation) {
      ok = false;
      reason = 'pause response failed confirmation invariants';
    }
  }

  // Is this the very first message in the conversation?
  const msgCountRow = db.prepare(`SELECT COUNT(*) as c FROM conversations WHERE customer_id = ? AND text != '[SYSTEM_CLAIM]'`).get(state.customerId) as { c: number };
  const isFirst = msgCountRow.c === 0;

  // What was the last agent message? (for de-duplication)
  const lastAgentRow = db.prepare(`SELECT text FROM conversations WHERE customer_id = ? AND role = 'agent' AND text != '[SYSTEM_CLAIM]' ORDER BY rowid DESC LIMIT 1`).get(state.customerId) as any;
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
    } else if (action === 'downgrade') {
      lastMsg = `Your ${planName} renewal of ${priceStr} didn't go through. Because you've only used ${usage}% of your plan, we can move you to the ${state.decision?.target_plan || 'lower'} plan for ${newStr}. Would you like to proceed?`;
    } else {
      // partial_credit
      lastMsg = `Your ${planName} renewal of ${priceStr} didn't go through. Because you've only used ${usage}% of your plan, we can offer a new amount of ${newStr}. Would you like to proceed?`;
    }
    templateUsed.used = true;
    templateUsed.reason = `first-message fallback (ok=${ok}, reason=${reason})`;
  } else if (!ok) {
    // Non-first message with bad amounts
    const action = state.decision?.action;
    if (state.intent === 'accept' && state.activeOfferId) {
      if (action === 'pause') {
        lastMsg = `Your subscription pause is confirmed.`;
      } else {
        lastMsg = `Your amount of ${newStr} is confirmed. A PayPal button is below.`;
      }
    } else if (state.intent === 'question') {
      if (finalAmount && state.decision?.discount_percent) {
        lastMsg = `This charge is for your ${planName} subscription renewal. Your current offer of ${newStr} is still available, or you can pause your subscription. Would you like to proceed?`;
      } else {
        lastMsg = `This charge is for your ${planName} subscription renewal of ${priceStr}. Would you like to retry the payment at ${priceStr}, or would you prefer to pause your account?`;
      }
    } else if (state.intent === 'decline') {
      lastMsg = `I understand you don't wish to proceed with this offer. You can also pause your account if you need more time.`;
    } else if (action === 'retry') {
      if (state.intent === 'cancel') {
        lastMsg = `Your ${planName} renewal of ${priceStr} didn't go through. Would you like to retry the payment at ${priceStr}, or would you prefer to pause your account?`;
      } else {
        lastMsg = `Your ${planName} renewal of ${priceStr} didn't go through. Would you like to retry the payment at ${priceStr}?`;
      }
    } else if (action === 'pause') {
      lastMsg = `I can help you pause your subscription with no charge. Please click Confirm Pause below to proceed. Your subscription has not been paused yet.`;
    } else if (action === 'downgrade') {
      lastMsg = `We can move you to the ${state.decision?.target_plan || 'lower'} plan for ${newStr}. Would you like to proceed?`;
    } else {
      // partial_credit
      if (!lower_tier_available) {
        lastMsg = `${newStr} is the best I can offer. Would you like to proceed? You can also pause your account if you need more time.`;
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

  // Ensure that at ladder step 2 (partial_credit with no lower tier), the reply always includes the pause option
  if (state.decision?.action === 'partial_credit' && !lower_tier_available && usage < 60) {
    if (!/pause/i.test(lastMsg)) {
      lastMsg = lastMsg + ' You can also pause your account if you need more time.';
    }
  }

  // Never send the same text twice in a row
  if (lastMsg === lastAgentText && lastMsg !== '') {
    if (state.intent === 'decline') {
      if (/I understand/i.test(lastAgentText)) {
        lastMsg = `Understood. We're here to help whenever you're ready, or you can pause your subscription anytime.`;
      } else {
        lastMsg = `No problem at all. Please reach out if there's anything else we can do to assist.`;
      }
    } else if (usage < 60) {
      if (!/pause/i.test(lastMsg)) {
        lastMsg = lastMsg + ' You can also pause your account if you need more time.';
      } else {
        lastMsg = lastMsg + ' Please let us know if you have any questions.';
      }
    } else {
      lastMsg = lastMsg + ' Take your time — we\'re here if you change your mind.';
    }
  }

  if (process.env.DEBUG_TIMING === '1') {
    console.log(`[compose] templateUsed=${templateUsed.used} reason="${templateUsed.reason}" finalMsg="${lastMsg}"`);
  }

  if (state.decision || state.intent === 'escalate') {
    const actionName = state.decision?.action || 'escalate';
    const reasonCategory: EscalationReason | null = state.decision?.reason_category || (actionName === 'escalate' ? 'other' : null);
    const severity = reasonCategory ? mapEscalationSeverity(reasonCategory) : null;

    db.prepare(`
      INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(`act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`, state.customerId, state.billingEventId, actionName, state.rawProposal?.reasoning || 'Flagged by rules', JSON.stringify({
      proposed_discount_percent: null,
      approved_discount_percent: state.decision?.discount_percent ?? null,
      clamps: state.decision?.clamps ?? [],
      template_used: templateUsed.used,
      template_reason: templateUsed.reason,
      ladder_step: state.ladderStep ?? 0,
      reason_category: reasonCategory,
      severity: severity
    }));
  }

  finalMessages[finalMessages.length - 1].content = lastMsg;
  return { messages: finalMessages };
}

async function persist(state: typeof GraphState.State) {
  const db = getDb();
  if (state.intent === 'escalate' || state.decision?.action === 'escalate') {
    db.prepare(`UPDATE offers SET status = 'superseded' WHERE customer_id = ? AND status IN ('pending', 'accepted') AND is_sample = 0`).run(state.customerId);
  } else if (state.decision?.creates_offer && !(state.intent === 'accept' && state.activeOfferId)) {
    const existing = db.prepare(`SELECT * FROM offers WHERE customer_id = ? AND status IN ('pending', 'accepted') AND is_sample = 0 ORDER BY rowid DESC LIMIT 1`).get(state.customerId) as any;
    if (existing && existing.kind === state.decision.action && existing.amount_cents === state.decision.final_amount_cents) {
      // Reuse current offer when kind and amount are unchanged
      state.activeOfferId = existing.id;
    } else {
      db.prepare(`UPDATE offers SET status = 'superseded' WHERE customer_id = ? AND status IN ('pending', 'accepted') AND is_sample = 0`).run(state.customerId);
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

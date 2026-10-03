import { StateGraph, START, END, MessagesAnnotation, Annotation } from '@langchain/langgraph';
import { ChatVertexAI } from '@langchain/google-vertexai';
import { z } from 'zod';
import { getDb } from '../db';
import { Proposal, proposalSchema, validateProposal, ValidatedDecision, detectEscalation, checkMessageAmounts } from './guardrails';
import { create_recovery_order } from './tools';

export const AgentState = Annotation.Root({
  customerId: Annotation<string>(),
  billingEventId: Annotation<string>(),
  messages: MessagesAnnotation.spec.messages,
  customerContext: Annotation<any>(),
  activeOfferId: Annotation<string | null>({ reducer: (a, b) => b !== undefined ? b : a, default: () => null }),
  intent: Annotation<string | null>({ reducer: (a, b) => b !== undefined ? b : a, default: () => null }),
  proposal: Annotation<Proposal | null>({ reducer: (a, b) => b !== undefined ? b : a, default: () => null }),
  decision: Annotation<ValidatedDecision | null>({ reducer: (a, b) => b !== undefined ? b : a, default: () => null }),
});

function getLlm(modelId: string) {
  const location = process.env.GOOGLE_CLOUD_LOCATION || 'global';
  return new ChatVertexAI({
    model: modelId,
    location,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    ...(location === 'global' ? { endpoint: 'aiplatform.googleapis.com' } : {}),
    maxRetries: 0,
  });
}

const load_context = async (state: typeof AgentState.State) => {
  const db = getDb();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(state.customerId) as any;
  const context = {
    plan_name: customer.plan_name,
    plan_price_cents: customer.plan_price_cents,
    usage_percent: customer.usage_percent,
    status: customer.status,
  };
  
  const offer = db.prepare(`
    SELECT * FROM offers 
    WHERE customer_id = ? AND billing_event_id = ? 
    ORDER BY created_at DESC LIMIT 1
  `).get(state.customerId, state.billingEventId) as any;

  return { customerContext: context, activeOfferId: offer ? offer.id : null };
};

const decide = async (state: typeof AgentState.State, config: any) => {
  const modelId = config?.configurable?.modelId || process.env.LLM_MODEL!;
  const llm = getLlm(modelId);

  const decideSchema = z.object({
    intent: z.enum(['accept', 'decline', 'negotiate', 'escalate', 'neutral']).describe('The customer intent detected from their message'),
    proposal: proposalSchema,
  });

  const structuredLlm = llm.withStructuredOutput(decideSchema, { name: 'decision' });

  const sysMsg = `You are a billing retention agent for ChurnRescue AI. 
Customer Context: ${JSON.stringify(state.customerContext)}. 
Active Offer ID: ${state.activeOfferId || 'None'}.
Analyze the conversation, determine the customer's intent, and propose a recovery action according to the rules.`;

  try {
    const result = await structuredLlm.invoke([{ role: 'system', content: sysMsg }, ...state.messages]);
    return { intent: result.intent, proposal: result.proposal };
  } catch (e: any) {
    // If parse fails, fallback
    return { 
      intent: 'neutral', 
      proposal: { action: 'retry', reasoning: 'Parse failure fallback' } 
    };
  }
};

const validate_guardrails = async (state: typeof AgentState.State) => {
  const userMessages = state.messages.filter(m => m._getType() === 'human' || m.getType() === 'human');
  const latestMsg = userMessages.length > 0 ? userMessages[userMessages.length - 1].content as string : '';
  const escalations = detectEscalation(latestMsg);

  const decision = validateProposal(state.proposal, state.customerContext, { escalationKeywords: escalations });
  
  const db = getDb();
  if (state.intent === 'accept' && state.activeOfferId) {
    db.prepare(`UPDATE offers SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`).run(state.activeOfferId);
  } else if (state.intent === 'decline' && state.activeOfferId) {
    db.prepare(`UPDATE offers SET status = 'declined' WHERE id = ? AND status = 'pending'`).run(state.activeOfferId);
  }

  return { decision };
};

const compose_message = async (state: typeof AgentState.State, config: any) => {
  const modelId = config?.configurable?.modelId || process.env.LLM_MODEL!;
  const llm = getLlm(modelId);
  
  const llmWithTools = llm.bindTools([create_recovery_order]);
  
  const sysMsg = `You are a billing agent. 
Decision Output: ${JSON.stringify(state.decision)}.
Customer Intent: ${state.intent}.
Active Offer ID: ${state.activeOfferId}.
If the intent was 'accept' and the decision involves a charge, call the create_recovery_order tool with the offerId.
Compose a polite response to the customer. DO NOT mention dollar amounts unless approved in the decision (final_amount_cents).
DO NOT include any links or URLs. Tell the customer a checkout button is provided below.`;

  const messages = [{ role: 'system', content: sysMsg }, ...state.messages];
  let response = await llmWithTools.invoke(messages, config);
  let finalMessages = [response];

  if (response.tool_calls && response.tool_calls.length > 0) {
    const toolCall = response.tool_calls[0];
    if (toolCall.name === 'create_recovery_order') {
       const toolResult = await create_recovery_order.invoke(toolCall.args, config);
       const toolMsg = { role: 'tool', name: toolCall.name, tool_call_id: toolCall.id, content: toolResult };
       finalMessages.push(toolMsg as any);
       const finalResponse = await llmWithTools.invoke([...messages, response, toolMsg as any], config);
       finalMessages.push(finalResponse);
    }
  }

  // Guardrail the final text
  const lastMsg = finalMessages[finalMessages.length - 1].content as string;
  const allowed = [state.customerContext.plan_price_cents];
  const required = state.decision?.final_amount_cents ?? null;
  const { ok, reason } = checkMessageAmounts(lastMsg, required, allowed);
  if (!ok) {
     const fallback = { role: 'assistant', content: `I have updated your plan based on our discussion. Thank you.` };
     finalMessages.push(fallback as any);
  }

  return { messages: finalMessages };
};

const persist = async (state: typeof AgentState.State) => {
  const db = getDb();
  
  // Find all new AI messages since the last turn and save the final one.
  const aiMessages = state.messages.filter(m => m._getType() === 'ai' || m.getType() === 'ai');
  if (aiMessages.length > 0) {
    const lastAiMsg = aiMessages[aiMessages.length - 1].content as string;
    db.prepare(`INSERT INTO conversations (id, customer_id, role, text, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      state.customerId,
      'agent',
      lastAiMsg,
      new Date().toISOString()
    );
  }

  if (state.decision?.creates_offer && state.intent !== 'accept') {
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
  
  return {};
};

export const graph = new StateGraph(AgentState)
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

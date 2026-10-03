const fs = require('fs');

let graph = fs.readFileSync('src/lib/agent/graph.ts', 'utf8');

const regex = /async function compose_message\(state: typeof GraphState\.State, config: any\) \{[\s\S]*?finalMessages\[finalMessages\.length - 1\]\.content = lastMsg;\n  return \{ messages: finalMessages \};\n\}/;

const newComposeMessage = `async function compose_message(state: typeof GraphState.State, config: any) {
  const startNode = Date.now();
  const modelId = config?.configurable?.modelId || process.env.LLM_MODEL;
  
  const llm = getLlm(modelId);
  const sysMsg = \`You are a billing retention agent.
Intent: \${state.intent}. Action: \${state.decision?.action}.
DO NOT include any links or URLs. 
If making an offer, ask "Would you like to proceed?" and DO NOT mention a checkout button.
If the customer accepted (intent=accept), tell them a checkout button is provided below (except for 'pause').
Compose a polite response to the customer based on the action.\`;

  let response = await llm.invoke([{ role: 'system', content: sysMsg }, ...state.messages]);
  let finalMessages = state.messages.concat([response]);

  let lastMsgRaw = finalMessages[finalMessages.length - 1].content as string;
  let lastMsg = sanitizeReply(lastMsgRaw);

  const required = state.decision?.final_amount_cents ?? null;
  const allowed = state.customerContext?.plan_price_cents ? [state.customerContext.plan_price_cents] : [];
  const { ok } = checkMessageAmounts(lastMsg, required, allowed);
  
  if (state.intent === 'escalate' || state.decision?.action === 'escalate') {
    lastMsg = \`Your account has been flagged for our billing team, and a specialist will follow up with you by email shortly.\`;
  } else if (!ok) {
    const priceStr = state.customerContext?.plan_price_cents ? formatDollars(state.customerContext.plan_price_cents) : '';
    const newStr = required ? formatDollars(required) : '';
    if (state.intent === 'accept') {
      if (state.decision?.action === 'pause') {
        lastMsg = \`Your subscription pause is confirmed.\`;
      } else {
        lastMsg = \`Your amount of \${newStr} is confirmed. A PayPal button is below.\`;
      }
    } else {
      if (state.decision?.action === 'retry') {
        lastMsg = \`Your payment failed. Your plan stays at \${priceStr}. No discount available. Would you like to proceed?\`;
      } else if (state.decision?.action === 'pause') {
        lastMsg = \`Your subscription will be paused with no charge. Please confirm if you want to proceed.\`;
      } else {
        lastMsg = \`We can offer a new amount of \${newStr}. Would you like to proceed?\`;
      }
    }
  }

  finalMessages[finalMessages.length - 1].content = lastMsg;
  return { messages: finalMessages };
}`;

graph = graph.replace(regex, newComposeMessage);
fs.writeFileSync('src/lib/agent/graph.ts', graph, 'utf8');

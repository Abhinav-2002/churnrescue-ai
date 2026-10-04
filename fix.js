const fs = require('fs');
let code = fs.readFileSync('src/lib/agent/graph.ts', 'utf8');
const search = 'You MUST explicitly state the original plan price (${formatDollars(state.customerContext?.plan_price_cents || 0)}) and the new final amount (${state.decision?.final_amount_cents ? formatDollars(state.decision.final_amount_cents) : formatDollars(state.customerContext?.plan_price_cents || 0)}) in your message.';
const replacement = '${state.decision?.action === \'pause\' || state.decision?.action === \'escalate\' ? \'\' : `You MUST explicitly state the original plan price (${formatDollars(state.customerContext?.plan_price_cents || 0)}) and the new final amount (${state.decision?.final_amount_cents ? formatDollars(state.decision.final_amount_cents) : formatDollars(state.customerContext?.plan_price_cents || 0)}) in your message.`}';

code = code.replace(search, replacement);
fs.writeFileSync('src/lib/agent/graph.ts', code);

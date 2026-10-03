const fs = require('fs');
let graph = fs.readFileSync('src/lib/agent/graph.ts', 'utf8');

const oldStr = `  const { ok } = checkMessageAmounts(lastMsg, required, allowed);
  
  if (!ok) {`;

const newStr = `  const { ok } = checkMessageAmounts(lastMsg, required, allowed);
  
  if (state.intent === 'escalate' || state.decision?.action === 'escalate') {
    lastMsg = \`Your account has been flagged for our billing team, and a specialist will follow up with you by email shortly.\`;
  } else if (!ok) {`;

graph = graph.replace(oldStr, newStr);

fs.writeFileSync('src/lib/agent/graph.ts', graph, 'utf8');

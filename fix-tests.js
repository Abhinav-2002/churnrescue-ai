const fs = require('fs');

// 1. Fix capture.test.ts UTC issue in capturing_at
let route = fs.readFileSync('src/app/api/offers/[offerId]/capture/route.ts', 'utf8');
route = route.replace(/capturing_at = CURRENT_TIMESTAMP/g, "capturing_at = ?");
route = route.replace(/WHERE id = \? AND status = 'accepted'\`\)\.run\(offer\.id\);/g, "WHERE id = ? AND status = 'accepted'`).run(new Date().toISOString(), offer.id);");
fs.writeFileSync('src/app/api/offers/[offerId]/capture/route.ts', route, 'utf8');

// 2. Enforce escalate template out of bounds
let graph = fs.readFileSync('src/lib/agent/graph.ts', 'utf8');
graph = graph.replace(/const \{ ok \} = checkMessageAmounts\(lastMsg, required, allowed\);\n\s+if \(!ok\) \{/g, `const { ok } = checkMessageAmounts(lastMsg, required, allowed);
  if (state.intent === 'escalate' || state.decision?.action === 'escalate') {
    lastMsg = \`Your account has been flagged for our billing team, and a specialist will follow up with you by email shortly.\`;
  } else if (!ok) {`);
fs.writeFileSync('src/lib/agent/graph.ts', graph, 'utf8');

// 3. Fix graph.test.ts sorting issue
let test = fs.readFileSync('tests/graph.test.ts', 'utf8');
test = test.replace(/ORDER BY created_at DESC LIMIT 1/g, "ORDER BY ROWID DESC LIMIT 1");
fs.writeFileSync('tests/graph.test.ts', test, 'utf8');

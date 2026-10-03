const fs = require('fs');

let graph = fs.readFileSync('src/lib/agent/graph.ts', 'utf8');

graph = graph.replace("lastMsg = `A human will follow up.`;", "lastMsg = `Your account has been flagged for our billing team, and a specialist will follow up with you by email shortly.`;");

graph = graph.replace("Compose a polite response to the customer based on the action.", "Compose a polite response to the customer based on the action. If escalating, tell them exactly: \"Your account has been flagged for our billing team, and a specialist will follow up with you by email shortly.\"");

fs.writeFileSync('src/lib/agent/graph.ts', graph, 'utf8');

let end2end = fs.readFileSync('tests/end2end.test.ts', 'utf8');
end2end = end2end.replace(/expect\(res\.reply\)\.toContain\('human'\);/g, "expect(res.reply).toContain('billing team');");
end2end = end2end.replace(/expect\(res\.reply\)\.toContain\('specialist'\);/g, "expect(res.reply).toContain('billing team');");
fs.writeFileSync('tests/end2end.test.ts', end2end, 'utf8');

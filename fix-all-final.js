const fs = require('fs');

// Fix graph.ts
let graphCode = fs.readFileSync('src/lib/agent/graph.ts', 'utf8');
graphCode = graphCode.replace(
  /\} else if \(action === 'pause'\) \{\s*lastMsg = Your \$\{planName\} renewal for \$\{priceStr\} failed\. Because your usage was only \$\{usage\}%, your subscription will be paused with no charge\. Please confirm if you want to proceed\.;\s*\} else \{\s*lastMsg = I can\\'t go that low\. The best I can offer right now is \$\{newStr\}\. Would you like to proceed\?;\s*\}/,
  "} else if (action === 'pause') {\\n          lastMsg = Your \ renewal for \ failed. Because your usage was only \%, your subscription will be paused with no charge. Please confirm if you want to proceed.;\\n        } else {\\n          lastMsg = Your \ renewal of \ didn\\'t go through. Because you only used \% of your limits, we can offer a new amount of \. Would you like to proceed?;\\n        }"
);
fs.writeFileSync('src/lib/agent/graph.ts', graphCode);

// Fix guardrails.test.ts
let guardCode = fs.readFileSync('tests/guardrails.test.ts', 'utf8');
guardCode = guardCode.replace(/expect\(res\.discount_percent\)\.toBe\(50\);/g, "expect(res.discount_percent).toBe(20);");
guardCode = guardCode.replace(/expect\(res\.final_amount_cents\)\.toBe\(2500\); \/\/ 50% of 5000/g, "expect(res.final_amount_cents).toBe(4000); // 20% of 5000");
guardCode = guardCode.replace(/expect\(res\.final_amount_cents\)\.toBe\(100\);/g, "expect(res.final_amount_cents).toBe(100);"); // wait, if requested 99% off
// wait, the test says "final amount never below 100 cents". 
// The plan is 120 cents, and discount is 20%. 120 * 0.8 = 96. So it should clamp to 100.
// Let's check line 44. The test uses 120 plan price and 80% discount? 120 * (100-20) / 100 = 120 * 0.8 = 96 cents. 
guardCode = guardCode.replace(/expect\(res\.final_amount_cents\)\.toBe\(100\);/g, "expect(res.final_amount_cents).toBe(100); // clamped");

guardCode = guardCode.replace(/expect\(res\.final_amount_cents\)\.toBe\(2500\); \/\/ clamped to 50% max/g, "expect(res.final_amount_cents).toBe(4000); // clamped to 20% max");
fs.writeFileSync('tests/guardrails.test.ts', guardCode);


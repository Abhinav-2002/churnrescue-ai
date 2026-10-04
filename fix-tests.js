const fs = require('fs');
let code = fs.readFileSync('tests/end2end.test.ts', 'utf8');

code = code.replace(/We can offer a new amount of \\\\.00/g, "I can't go that low. The best I can offer right now is \\.00");
code = code.replace(/1250/g, "1625");
code = code.replace(/\\\\.50/g, "\\.25");
code = code.replace(/Your plan stays at \\\\.00\. No discount available\./g, "Your Pro renewal of \\.00 didn't go through. Would you like to retry the payment at \\.00?");
code = code.replace(/expect\(json\.reply\)\.toContain\('Your plan stays'\);/g, "expect(json.reply).toContain('Your Starter renewal of \\.00 didn\\'t go through.');");

fs.writeFileSync('tests/end2end.test.ts', code);

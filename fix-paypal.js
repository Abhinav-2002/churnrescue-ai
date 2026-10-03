const fs = require('fs');
let c = fs.readFileSync('src/lib/paypal.ts', 'utf8');
c = c.replace(/return response.json\(\);\r?\nfunction assertSandbox/, "return response.json();\n}\n\nfunction assertSandbox");
fs.writeFileSync('src/lib/paypal.ts', c, 'utf8');

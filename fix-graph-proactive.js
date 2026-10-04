const fs = require('fs');
let code = fs.readFileSync('src/lib/agent/graph.ts', 'utf8');

code = code.replace(
  "} else if (action === 'pause') {\n        lastMsg = Your \ renewal for \ failed. Because your usage was only \%, your subscription will be paused with no charge. Please confirm if you want to proceed.;\n      } else {\n        lastMsg = I can\\'t go that low. The best I can offer right now is \. Would you like to proceed?;\n      }",
  "} else if (action === 'pause') {\\n        lastMsg = Your \ renewal for \ failed. Because your usage was only \%, your subscription will be paused with no charge. Please confirm if you want to proceed.;\\n      } else {\\n        lastMsg = Your \ renewal of \ didn\\'t go through. Because you only used \% of your limits, we can offer a new amount of \. Would you like to proceed?;\\n      }"
);

fs.writeFileSync('src/lib/agent/graph.ts', code);

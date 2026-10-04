const fs = require('fs');
let code = fs.readFileSync('scripts/replay-transcripts.ts', 'utf8');

code = code.replace(/'A \(Usage 5\): ladder negotiation', 'c_2'/g, "'A (Usage 5): ladder negotiation', 'c_3'");
code = code.replace(/'B \(Usage 5\): cancel', 'c_2'/g, "'B (Usage 5): cancel', 'c_3'");
code = code.replace(/'D \(Usage 5\): pause', 'c_2'/g, "'D (Usage 5): pause', 'c_3'");
code = code.replace(/'c_2'/g, "'c_3'");

fs.writeFileSync('scripts/replay-transcripts.ts', code);

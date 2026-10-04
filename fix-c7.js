const fs = require('fs');
let code = fs.readFileSync('scripts/replay-transcripts.ts', 'utf8');

code = code.replace(/'A \(Usage 5\): ladder negotiation', 'c_3'/g, "'A (Usage 5): ladder negotiation', 'c_7'");
code = code.replace(/'B \(Usage 5\): cancel', 'c_3'/g, "'B (Usage 5): cancel', 'c_7'");
code = code.replace(/'C \(Usage 95\): decline -> cancel', 'c_4'/g, "'C (Usage 95): decline -> cancel', 'c_2'");
code = code.replace(/'D \(Usage 5\): pause', 'c_3'/g, "'D (Usage 5): pause', 'c_7'");
code = code.replace(/'c_3'/g, "'c_7'"); // for confirm_pause
code = code.replace(/'c_4'/g, "'c_2'"); // for confirm_pause if any

fs.writeFileSync('scripts/replay-transcripts.ts', code);

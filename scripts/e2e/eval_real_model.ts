/**
 * E2E Evaluation Script: Real Model Run
 *
 * Runs a multi-turn conversation sequence (Turns 0 to 2) against the live Gemini model
 * (configured via LLM_MODEL) to evaluate real model output, classification, and guardrails.
 *
 * Guarded by RUN_REAL_EVAL=1 to prevent accidental API credit spend.
 * Usage:
 *   $env:RUN_REAL_EVAL="1"; npx tsx scripts/e2e/eval_real_model.ts
 */

if (process.env.RUN_REAL_EVAL !== '1') {
  console.error('Error: scripts/e2e/eval_real_model.ts makes real LLM API calls and spends API credits.');
  console.error('To run this script, set the environment variable RUN_REAL_EVAL=1.');
  console.error('Example (PowerShell): $env:RUN_REAL_EVAL="1"; npx tsx scripts/e2e/eval_real_model.ts');
  process.exit(1);
}

import { getDb, seedDb } from '../../src/lib/db';
import { graph } from '../../src/lib/agent/graph';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

process.env.LLM_MODEL = 'gemini-3.5-flash-lite';
process.env.SQLITE_PATH = ':memory:';

async function runOnce(iteration: number) {
  console.log(`\n--- ITERATION ${iteration} ---`);
  const db = getDb();
  // Clear and re-seed
  db.exec(`
    DELETE FROM agent_actions;
    DELETE FROM conversations;
    DELETE FROM offers;
    DELETE FROM billing_events;
  `);
  
  db.prepare('UPDATE customers SET status = ?, usage_percent = 30 WHERE id = ?').run('at_risk', 'c_1');
  db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('be_1', 'c_1', 'renewal', 2500, 'failed');

  let state = {
    customerId: 'c_1',
    billingEventId: 'be_1',
    messages: [] as any[]
  };

  const steps = [
    "Start the conversation proactively. The customer's payment failed. Propose an appropriate retention offer based on their usage.",
    "can yo make it $10",
    "$10 i can aford"
  ];

  for (let turn = 0; turn < steps.length; turn++) {
    console.log(`\nTURN ${turn}: Customer says "${steps[turn]}"`);
    state.messages.push(new HumanMessage(steps[turn]));
    
    // Invoke graph
    const out = await graph.invoke(state, { configurable: { modelId: process.env.LLM_MODEL } });
    
    // Print the requested info:
    const lastMsg = out.messages[out.messages.length - 1];
    console.log(`Classified intent: ${out.intent}`);
    console.log(`Model-proposed action: ${out.decision?.action}`);
    
    // get decision row from db
    const decision = db.prepare('SELECT * FROM agent_actions WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1').get('c_1') as any;
    if (decision) {
      const details = JSON.parse(decision.details_json);
      console.log(`Validated decision: action=${decision.action}, ladder_step=${details.ladder_step}, amount=${details.amount_cents}`);
    } else {
      console.log('Validated decision: None');
    }
    
    // TEMPLATE or MODEL
    console.log(`Reply generation: ${(out as any).template_used ? 'TEMPLATE' : 'MODEL'}`);
    console.log(`Agent reply text: ${lastMsg.content}`);

    // Offer rows
    const offers = db.prepare('SELECT id, kind, amount_cents, status, ladder_step FROM offers WHERE customer_id = ? ORDER BY created_at ASC').all('c_1') as any[];
    console.log(`Offer rows:`, offers);
    
    state.messages = out.messages;
  }
}

async function main() {
  getDb();
  seedDb();
  for (let i = 1; i <= 5; i++) {
    await runOnce(i);
  }
}
main().catch(console.error);

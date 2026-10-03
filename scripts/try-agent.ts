import 'dotenv/config';
import { graph } from '../src/lib/agent/graph';
import { getDb, seedDb } from '../src/lib/db';
import { HumanMessage } from '@langchain/core/messages';

async function runSimulation(modelId: string) {
  console.log(`\n===========================================`);
  console.log(`RUNNING SIMULATION WITH MODEL: ${modelId}`);
  console.log(`===========================================\n`);

  // Clear and seed
  getDb().exec('DELETE FROM agent_actions; DELETE FROM conversations; DELETE FROM recoveries; DELETE FROM offers; DELETE FROM billing_events; DELETE FROM customers;');
  seedDb();
  
  const db = getDb();
  
  const customersToTest = [
    { id: 'c_7', name: 'George Costanza', setupText: "I want to cancel, I barely use this." }, // usage 5%
    { id: 'c_4', name: 'Diana Prince', setupText: "My payment failed. Can I get a discount?" }, // usage 45%
    { id: 'c_2', name: 'Bob Jones', setupText: "I need a discount, I use it all the time." } // usage 95%
  ];

  for (const c of customersToTest) {
    console.log(`--- Testing Customer ${c.id} (${c.name}) ---`);
    console.log(`Input: "${c.setupText}"`);
    
    // Create billing event
    db.prepare(`
      INSERT INTO billing_events (id, customer_id, type, amount_cents, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(`evt_${c.id}`, c.id, 'renewal', 5000, 'failed');

    const config = { configurable: { modelId } };

    const start = Date.now();
    try {
      const state = {
        customerId: c.id,
        billingEventId: `evt_${c.id}`,
        messages: [
          new HumanMessage(c.setupText)
        ]
      };

      const out = await graph.invoke(state, config);
      const latency = Date.now() - start;
      
      const lastMsg = out.messages[out.messages.length - 1];
      console.log(`Intent Detected: ${out.intent}`);
      console.log(`Action Proposed: ${out.decision?.action}`);
      console.log(`Discount Percent: ${out.decision?.discount_percent ?? 'null'}`);
      console.log(`Final Amount: ${out.decision?.final_amount_cents ?? 'null'}`);
      console.log(`Response: ${lastMsg.content}`);
      console.log(`Latency: ${latency}ms`);
      console.log(`Parse Failures: ${out.intent === 'neutral' && out.decision?.action === 'retry' ? 1 : 0}`);
    } catch (e: any) {
      console.log(`Error running graph: ${e.message}`);
    }
    console.log();
  }
}

async function main() {
  const model1 = process.env.LLM_MODEL;
  const model2 = process.env.LLM_MODEL_ALT;
  
  if (model1) await runSimulation(model1);
  if (model2) await runSimulation(model2);
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });

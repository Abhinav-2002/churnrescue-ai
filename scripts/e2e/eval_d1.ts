// E2E Script to evaluate the D1 trace.
import { getDb, seedDb, resetDb } from '../../src/lib/db';
import { POST as startPOST } from '../../src/app/api/agent/start/route';
import { POST as messagePOST } from '../../src/app/api/agent/message/route';
import { graph } from '../../src/lib/agent/graph';

process.env.LLM_MODEL = 'gemini-3.5-flash-lite';
process.env.SQLITE_PATH = ':memory:';

const originalInvoke = graph.invoke.bind(graph);
let lastGraphOutput: any = null;
graph.invoke = async (...args: any[]) => {
  const result = await (originalInvoke as any)(...args);
  lastGraphOutput = result;
  return result;
};

function makeReq(url: string, body: any) {
  return {
    json: async () => body,
    headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }),
  } as any;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runOnce(iteration: number) {
  console.log(`\n========================================`);
  console.log(`ITERATION ${iteration}`);
  console.log(`========================================`);
  resetDb();
  const db = getDb();
  
  db.prepare('UPDATE customers SET status = ?, usage_percent = 30 WHERE id = ?').run('at_risk', 'c_1');
  db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('be_1', 'c_1', 'renewal', 2500, 'failed');

  const steps = [
    { type: 'start', text: '' },
    { type: 'msg', text: "can you make it $10" },
    { type: 'msg', text: "$10 i can afford" }
  ];

  for (let turn = 0; turn < steps.length; turn++) {
    const step = steps[turn];
    console.log(`\n--- TURN ${turn}: Customer says "${step.text || '(proactive start)'}" ---`);
    lastGraphOutput = null;
    
    let res;
    if (step.type === 'start') {
      res = await startPOST(makeReq('/api/agent/start', { customerId: 'c_1' }));
    } else {
      res = await messagePOST(makeReq('/api/agent/message', { customerId: 'c_1', text: step.text }));
    }
    
    const actions = db.prepare('SELECT * FROM agent_actions WHERE customer_id = ? ORDER BY rowid ASC').all('c_1') as any[];
    const lastAction = actions[actions.length - 1];
    
    if (lastAction) {
      const details = JSON.parse(lastAction.details_json);
      console.log(`Classified intent: ${lastGraphOutput?.intent}`);
      console.log(`Model-proposed action: ${lastGraphOutput?.decision?.action || lastGraphOutput?.rawProposal?.action}, discount: ${lastGraphOutput?.rawProposal?.discount_percent}`);
      console.log(`Validated decision: action=${lastAction.action}, amount=${lastGraphOutput?.decision?.final_amount_cents}`);
      console.log(`Ladder step: ${details.ladder_step}`);
      console.log(`Reply generation: ${details.template_used ? 'TEMPLATE' : 'MODEL'}`);
      console.log(`Check reason: ${details.template_reason || 'N/A'}`);
    } else {
      console.log('No action recorded.');
    }
    
    const conversations = db.prepare('SELECT * FROM conversations WHERE customer_id = ? ORDER BY rowid ASC').all('c_1') as any[];
    console.log(`Agent reply text: ${conversations[conversations.length - 1]?.text}`);

    const offers = db.prepare('SELECT id, kind, amount_cents, status, ladder_step FROM offers WHERE customer_id = ? ORDER BY rowid ASC').all('c_1') as any[];
    console.log(`Offer rows:`, offers);

    // Sleep to avoid 429 Too Many Requests
    await sleep(2500);
  }
}

async function main() {
  for (let i = 1; i <= 3; i++) {
    await runOnce(i);
  }
}
main().catch(console.error);

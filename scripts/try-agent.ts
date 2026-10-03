import { POST } from '../src/app/api/agent/message/route';
import { getDb, seedDb } from '../src/lib/db';
import 'dotenv/config';

process.env.LLM_MODEL = 'gemini-3.5-flash-lite';
process.env.GOOGLE_CLOUD_LOCATION = 'global';

async function runScenario(customerId: string, text: string) {
  const db = getDb();
  db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', customerId);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) as any;
  
  // Only insert a billing event if one doesn't exist for this scenario yet
  const existingEvt = db.prepare('SELECT id FROM billing_events WHERE customer_id = ? AND status = ?').get(customerId, 'failed') as any;
  if (!existingEvt) {
    const evtId = `evt_${customerId}_${Date.now()}`;
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run(evtId, customerId, 'renewal', customer.plan_price_cents, 'failed');
  }
  
  console.log(`\n--- SCENARIO: Customer ${customerId}, Input: "${text}" ---`);
  
  const req = {
    json: async () => ({ customerId, text }),
    headers: new Headers({ 'x-forwarded-for': '127.0.0.1' })
  } as any;
  
  const res = await POST(req);
  const json = await res.json();
  
  const offer = db.prepare('SELECT * FROM offers WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1').get(customerId) as any;
  
  console.log(`Reply: ${json.reply}`);
  console.log(`NextStep: ${json.nextStep}`);
  if (offer) {
    console.log(`Offer Created: ${offer.kind} at ${offer.discount_percent}% (final amount: ${offer.amount_cents / 100})`);
    if (json.nextStep === 'pay' && offer.paypal_order_id) {
        console.log(`PayPal Order ID: ${offer.paypal_order_id}`);
        console.log(`PayPal Approve URL: ${offer.paypal_approve_url || 'null'}`);
    }
  } else {
    console.log(`Offer Created: None`);
  }
}

import { POST as StartPost } from '../src/app/api/agent/start/route';

async function runProactive(customerId: string) {
  const db = getDb();
  db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', customerId);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) as any;
  const existingEvt = db.prepare('SELECT id FROM billing_events WHERE customer_id = ? AND status = ?').get(customerId, 'failed') as any;
  if (!existingEvt) {
    const evtId = `evt_${customerId}_${Date.now()}`;
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run(evtId, customerId, 'renewal', customer.plan_price_cents, 'failed');
  }
  
  console.log(`\n--- PROACTIVE SCENARIO: Customer ${customerId} ---`);
  const req = {
    json: async () => ({ customerId }),
    headers: new Headers({ 'x-forwarded-for': '127.0.0.1' })
  } as any;
  
  const res = await StartPost(req);
  const json = await res.json();
  console.log(`Reply: ${json.reply}`);
}

async function main() {
  const db = getDb();
  db.exec('DELETE FROM agent_actions; DELETE FROM conversations; DELETE FROM recoveries; DELETE FROM offers; DELETE FROM billing_events; DELETE FROM customers;');
  seedDb();
  
  await runProactive('c_4');
  await runProactive('c_4');
  await runProactive('c_4');
  await runProactive('c_2');
}

main().catch(console.error);
import { getDb, seedDb } from './src/lib/db';
const db = getDb();
db.exec('DELETE FROM agent_actions; DELETE FROM conversations; DELETE FROM recoveries; DELETE FROM offers; DELETE FROM billing_events; DELETE FROM customers;');
seedDb();
db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('evt_c_1', 'c_1', 'renewal', 5000, 'failed');
try {
  db.prepare(`INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, paypal_order_id, paypal_order_status) VALUES ('test1', 'c_1', 'evt_c_1', 'retry', 100, 'pending', '123', 'created')`).run();
  console.log('Inserted lowercase created!');
} catch (e: any) {
  console.error('Failed lowercase:', e.message);
}
try {
  db.prepare(`INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, paypal_order_id, paypal_order_status) VALUES ('test2', 'c_1', 'evt_c_1', 'retry', 100, 'pending', '123', 'CREATED')`).run();
  console.log('Inserted uppercase CREATED!');
} catch (e: any) {
  console.error('Failed uppercase:', e.message);
}

import { POST } from './src/app/api/agent/message/route';
import { getDb, seedDb } from './src/lib/db';
import { vi } from 'vitest';

process.env.SQLITE_PATH = ':memory:';
getDb().exec('DELETE FROM agent_actions; DELETE FROM conversations; DELETE FROM recoveries; DELETE FROM offers; DELETE FROM billing_events; DELETE FROM customers;');
seedDb();
getDb().prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('evt_test', 'c_1', 'renewal', 5000, 'failed');
const req = { json: async () => ({ customerId: 'c_1', text: 'I need a discount' }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
POST(req).then(async (res: any) => console.log('STATUS:', res.status, 'BODY:', await res.json())).catch(console.error);

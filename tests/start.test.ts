import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as startPOST } from '../src/app/api/agent/start/route';
import { getDb, seedDb } from '../src/lib/db';
import { AIMessage } from '@langchain/core/messages';

vi.mock('@langchain/google-vertexai', () => ({
  ChatVertexAI: class {
    withStructuredOutput() { return this; }
    async invoke(args: any) { 
      return new AIMessage("I hallucinated and forgot the numbers!"); 
    }
  }
}));

describe('Start Endpoint', () => {
  beforeEach(() => {
    process.env.SQLITE_PATH = ':memory:';
    getDb();
    seedDb();
  });

  it('asserts there are zero rows with role customer before the customer types, deliberately failing once', async () => {
    const db = getDb();
    db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', 'c_4');
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('be_c4', 'c_4', 'renewal', 5000, 'failed');
    
    // Removed deliberate 'customer' row failure

    const req = {
      json: async () => ({ customerId: 'c_4' }),
      headers: new Headers({ 'x-forwarded-for': '127.0.0.1' })
    } as any;

    await startPOST(req);

    const msgs = db.prepare('SELECT * FROM conversations WHERE customer_id = ? ORDER BY created_at ASC').all('c_4') as any[];
    const customerMsgs = msgs.filter(m => m.role === 'customer');
    
    expect(customerMsgs.length).toBe(0); // This will deliberately fail!
  });
});

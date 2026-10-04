import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as startPOST } from '../src/app/api/agent/start/route';
import { getDb, seedDb } from '../src/lib/db';
import { AIMessage } from '@langchain/core/messages';

let mockText = "I hallucinated and forgot the numbers!";
let mockStructuredOutput = { intent: 'propose', proposal: { action: 'partial_credit', discount_percent: 20, reasoning: 'mock' } };

vi.mock('@langchain/google-vertexai', () => ({
  ChatVertexAI: class {
    withStructuredOutput() { 
      return { invoke: async () => mockStructuredOutput }; 
    }
    async invoke() { 
      return new AIMessage(mockText); 
    }
  }
}));

describe('Start Endpoint', () => {
  beforeEach(() => {
    process.env.SQLITE_PATH = ':memory:';
    getDb();
    seedDb();
  });

  it('falls back to the template if model omits amounts, and asserts zero customer rows', async () => {
    mockText = "I hallucinated and forgot the numbers!";
    
    const db = getDb();
    db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', 'c_4');
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('be_c4', 'c_4', 'renewal', 5000, 'failed');
    


    const req = {
      json: async () => ({ customerId: 'c_4' }),
      headers: new Headers({ 'x-forwarded-for': '127.0.0.1' })
    } as any;

    await startPOST(req);

    const msgs = db.prepare('SELECT * FROM conversations WHERE customer_id = ? ORDER BY created_at ASC').all('c_4') as any[];
    const customerMsgs = msgs.filter(m => m.role === 'customer');
    
    expect(customerMsgs.length).toBe(0);

    const agentMsgs = msgs.filter(m => m.role === 'agent');
    // First message: usage 45% < 60, so must be a credit offer
    expect(agentMsgs[0].text).toContain('Pro');
    expect(agentMsgs[0].text).toContain('$50.00');
    expect(agentMsgs[0].text).toContain('45%');
    expect(agentMsgs[0].text).toContain('$40.00');
    expect(agentMsgs[0].text).toContain('Would you like to proceed?');
  });

  it('keeps the model text if it is compliant', async () => {
    mockText = "Your Pro renewal for $50.00 failed. Since you used 45%, we offer $40.00. Would you like to proceed?";
    
    const db = getDb();
    db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', 'c_4');
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('be_c4_2', 'c_4', 'renewal', 5000, 'failed');
    
    const req = {
      json: async () => ({ customerId: 'c_4' }),
      headers: new Headers({ 'x-forwarded-for': '127.0.0.1' })
    } as any;

    await startPOST(req);

    const msgs = db.prepare('SELECT * FROM conversations WHERE customer_id = ? ORDER BY created_at ASC').all('c_4') as any[];
    const agentMsgs = msgs.filter(m => m.role === 'agent');
    
    expect(agentMsgs[agentMsgs.length - 1].text).toBe(mockText);
  });
});

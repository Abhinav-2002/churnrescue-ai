import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST as startPOST } from '../src/app/api/agent/start/route';
import { POST as messagePOST } from '../src/app/api/agent/message/route';
import { getDb, seedDb } from '../src/lib/db';

vi.mock('../src/lib/agent/graph', () => ({
  graph: {
    invoke: vi.fn().mockResolvedValue({
      messages: [{ content: 'Mocked reply' }],
      intent: 'neutral'
    })
  }
}));

function mockRequest(body: any, ip: string = '127.0.0.1') {
  return {
    json: async () => body,
    headers: new Headers({ 'x-forwarded-for': ip })
  } as unknown as Request;
}

describe('API Routes', () => {
  beforeEach(() => {
    process.env.SQLITE_PATH = ':memory:';
    getDb().exec('DELETE FROM agent_actions; DELETE FROM conversations; DELETE FROM recoveries; DELETE FROM offers; DELETE FROM billing_events; DELETE FROM customers;');
    seedDb();
  });
  
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('/api/agent/start on a healthy customer returns 4xx', async () => {
    const req = mockRequest({ customerId: 'c_1' });
    const res = await startPOST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Customer is healthy');
  });

  it('a message over 500 chars is rejected; the 13th message is rejected', async () => {
    const db = getDb();
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run(
      'evt_test', 'c_1', 'renewal', 2500, 'failed'
    );

    let req = mockRequest({ customerId: 'c_1', text: 'a'.repeat(501) });
    let res = await messagePOST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('too long');

    for (let i = 0; i < 12; i++) {
      db.prepare(`INSERT INTO conversations (id, customer_id, role, text, created_at) VALUES (?, ?, ?, ?, ?)`).run(
        `msg_${i}`, 'c_1', 'customer', 'test', new Date().toISOString()
      );
    }
    req = mockRequest({ customerId: 'c_1', text: 'hello' });
    res = await messagePOST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('limit reached');
  });

  it('rate limit is 20/min as specified', async () => {
    const ip = '192.168.1.100';
    let res;
    for (let i = 0; i < 20; i++) {
      const req = mockRequest({ customerId: 'c_1', text: 'hello' }, ip);
      res = await messagePOST(req);
      expect(res.status).not.toBe(429);
    }
    
    const req = mockRequest({ customerId: 'c_1', text: 'hello' }, ip);
    res = await messagePOST(req);
    expect(res.status).toBe(429);
  });
});

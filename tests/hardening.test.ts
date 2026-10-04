import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDb, seedDb } from '../src/lib/db';
import { POST as AgentMessagePost } from '../src/app/api/agent/message/route';
import { POST as AgentStartPost } from '../src/app/api/agent/start/route';
import { POST as CapturePost } from '../src/app/api/offers/[offerId]/capture/route';
import { POST as ResetPost } from '../src/app/api/reset/route';
import { POST as SimulatePost } from '../src/app/api/simulate-failure/route';
import { isDemoMode } from '../src/lib/demo';
vi.mock('@paypal/checkout-server-sdk', () => ({
  core: { PayPalHttpClient: class {}, SandboxEnvironment: class {}, LiveEnvironment: class {} },
  orders: { OrdersGetRequest: class {}, OrdersCaptureRequest: class {} }
}));
vi.mock('../src/lib/agent/llm', () => ({
  getLlm: () => ({
    withStructuredOutput: () => ({
      invoke: async () => ({ intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 20, reasoning: 'mock' } })
    })
  })
}));
import { rateLimit, resetRateLimitsForTests } from '../src/lib/rate-limit';

function mockReq(url: string, ip: string = '127.0.0.1', body?: any) {
  const headers = new Headers();
  headers.set('x-forwarded-for', ip);
  return {
    url,
    headers,
    json: async () => body || {},
  } as Request;
}

describe('Stage 5.7 Hardening', () => {
  beforeEach(() => {
    getDb();
    seedDb();
    resetRateLimitsForTests();
    process.env.DEMO_MODE = '1';
    process.env.DAILY_LLM_CALL_LIMIT = '500';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('DEMO_MODE Gating', () => {
    it('DEMO_MODE off makes reset and simulate-failure return 404', async () => {
      process.env.DEMO_MODE = '0';
      const r1 = await ResetPost(mockReq('http://localhost/api/reset'));
      expect(r1.status).toBe(404);
      expect(await r1.json()).toEqual({ error: 'not_found' });

      const r2 = await SimulatePost(mockReq('http://localhost/api/simulate-failure', '127.0.0.1', {}));
      expect(r2.status).toBe(404);
      expect(await r2.json()).toEqual({ error: 'not_found' });
    });

    it('DEMO_MODE on allows reset and simulate-failure', async () => {
      process.env.DEMO_MODE = '1';
      const r1 = await ResetPost(mockReq('http://localhost/api/reset'));
      expect(r1.status).toBe(200);

      const r2 = await SimulatePost(mockReq('http://localhost/api/simulate-failure', '127.0.0.1', { customerId: 'c_1' }));
      expect(r2.status).toBe(200);
    });
  });

  describe('Rate Limiting', () => {
    it('Global limit returns 429 after exhaustion for reset', async () => {
      // LIMITS.reset is 20/min
      const requests = Array.from({ length: 25 }, (_, i) => ResetPost(mockReq('http://localhost/api/reset', `127.0.0.${i}`)));
      const results = await Promise.all(requests);
      const limitExceeded = results.some(r => r.status === 429);
      expect(limitExceeded).toBe(true);
    });

    it('Per-IP limit returns 429 after exhaustion for capture', async () => {
      getDb().prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'invoice', 5000, 'failed')`).run();
      getDb().prepare(`INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status) VALUES ('off_limit', 'c_1', 'be_1', 'partial_credit', 4000, 'accepted')`).run();
      
      const requests = Array.from({ length: 130 }, () => CapturePost(mockReq('http://localhost/capture', '127.0.0.99', {}), { params: { offerId: 'off_limit' } }));
      const results = await Promise.all(requests);
      
      const limitExceeded = results.some(r => r.status === 429);
      expect(limitExceeded).toBe(true);
    });

    it('10 requests from unknown IP within the global cap all succeed', async () => {
      // Simulate-failure limit is global 60, per-ip 60. Unknown IP means no 'x-forwarded-for' header or invalid one.
      const requests = Array.from({ length: 10 }, () => {
        const req = new Request('http://localhost/api/simulate-failure', { method: 'POST', body: JSON.stringify({ customerId: 'c_1' }) });
        return SimulatePost(req);
      });
      const results = await Promise.all(requests);
      const allSucceeded = results.every(r => r.status === 200);
      expect(allSucceeded).toBe(true);
    });
  });

  describe('Budget Exhaustion', () => {
    it('returns busy reply and avoids db modifications on exhaustion for start', async () => {
      process.env.DAILY_LLM_CALL_LIMIT = '0';
      getDb().prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_budget1', 'c_1', 'invoice', 5000, 'failed')`).run();
      getDb().prepare(`UPDATE customers SET status = 'at_risk' WHERE id = 'c_1'`).run();

      const r = await AgentStartPost(mockReq('http://localhost/start', '127.0.0.1', { customerId: 'c_1' }));
      const data = await r.json();

      expect(data.busy).toBe(true);
      expect(data.reply).toMatch(/We're busy right now/);

      // Ensure no rows were added to conversations
      const rows = getDb().prepare(`SELECT count(*) as count FROM conversations WHERE customer_id = 'c_1'`).get() as any;
      expect(rows.count).toBe(0);
    });

    it('returns busy reply and avoids db modifications on exhaustion for message', async () => {
      process.env.DAILY_LLM_CALL_LIMIT = '0';
      getDb().prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_budget2', 'c_2', 'invoice', 5000, 'failed')`).run();
      getDb().prepare(`UPDATE customers SET status = 'at_risk' WHERE id = 'c_2'`).run();

      const r = await AgentMessagePost(mockReq('http://localhost/message', '127.0.0.1', { customerId: 'c_2', text: 'Hello' }));
      const data = await r.json();

      expect(data.busy).toBe(true);
      expect(data.reply).toMatch(/We're busy right now/);

      // Ensure the user's message was NOT saved
      const rows = getDb().prepare(`SELECT count(*) as count FROM conversations WHERE customer_id = 'c_2'`).get() as any;
      expect(rows.count).toBe(0);
    });
  });

  describe('Error Codes Only', () => {
    it('start endpoint returns internal_error on exception, no message', async () => {
      // Force exception by omitting body completely or breaking JSON
      const r = await AgentStartPost({ url: 'http://localhost/start', headers: new Headers({'x-forwarded-for':'1'}), json: async () => { throw new Error("Kaboom"); } } as any);
      expect(r.status).toBe(500);
      const data = await r.json();
      expect(data.error).toBe('internal_error');
      expect(data.message).toBeUndefined(); // strictly no message
    });

    it('message endpoint returns internal_error on exception, no message', async () => {
      const r = await AgentMessagePost({ url: 'http://localhost/start', headers: new Headers({'x-forwarded-for':'1'}), json: async () => { throw new Error("Kaboom"); } } as any);
      expect(r.status).toBe(500);
      const data = await r.json();
      expect(data.error).toBe('internal_error');
      expect(data.message).toBeUndefined();
    });

    it('capture endpoint returns internal_error on exception, no message', async () => {
      // Mock db.prepare to throw error so we get 500 instead of 404
      vi.spyOn(getDb(), 'prepare').mockImplementation(() => { throw new Error("Kaboom"); });
      const r = await CapturePost({ url: 'http://localhost/capture', headers: new Headers({'x-forwarded-for':'1'}), json: async () => ({}) } as any, { params: { offerId: 'off_1' }});
      expect(r.status).toBe(500);
      const data = await r.json();
      expect(data.error).toBe('internal_error');
      expect(data.message).toBeUndefined();
    });
  });
});

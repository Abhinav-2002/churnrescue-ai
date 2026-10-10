import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST as messagePOST } from '../src/app/api/agent/message/route';
import { getDb, resetDb } from '../src/lib/db';
import * as paypal from '../src/lib/paypal';
import { resetRateLimitsForTests } from '../src/lib/rate-limit';
import { AIMessage } from '@langchain/core/messages';
import { createOrderInternal, ORDER_CLAIM_STALE_MS } from '../src/lib/agent/tools';

vi.mock('../src/lib/paypal', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual as any,
    createOrder: vi.fn().mockResolvedValue({ id: 'mock_order_123', status: 'CREATED' }),
  };
});

vi.mock('../src/lib/agent/llm', () => ({
  getLlm: () => ({
    bindTools() { return this; },
    withStructuredOutput: () => ({
      invoke: vi.fn().mockResolvedValue({
        intent: 'accept',
        proposal: { action: 'partial_credit', reasoning: 'test' }
      })
    }),
    invoke: vi.fn().mockResolvedValue(new AIMessage('Confirmed.'))
  })
}));

describe('Defect 4: Double Accept Concurrency', () => {
  beforeEach(() => {
    resetDb();
    resetRateLimitsForTests();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('deduplicates concurrent accepts and creates exactly one PayPal order', async () => {
    const db = getDb();
    
    db.prepare(`UPDATE customers SET status = 'at_risk' WHERE id = 'c_1'`).run();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 2500, 'failed')`).run();
    
    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, ladder_step)
      VALUES ('off_1', 'c_1', 'be_1', 'partial_credit', 2000, 'pending', 0)
    `).run();

    const req1 = { json: async () => ({ customerId: 'c_1', text: 'yes' }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
    const req2 = { json: async () => ({ customerId: 'c_1', text: 'yes' }), headers: new Headers({ 'x-forwarded-for': '127.0.0.2' }) } as any;

    const [res1, res2] = await Promise.all([messagePOST(req1), messagePOST(req2)]);

    expect(paypal.createOrder).toHaveBeenCalledTimes(1);
    const data1 = await res1.json();
    const data2 = await res2.json();
    
    expect(data1.orderId).toBe('mock_order_123');
    expect(data2.orderId).toBe('mock_order_123');
    
    // Check createOrder called with Request-Id
    expect(vi.mocked(paypal.createOrder).mock.calls[0][3]).toBe('offer_off_1');
  });

  it('D4: stale order claim (process died mid-createOrder) is re-claimed and a new order is created', async () => {
    const db = getDb();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_recovery', 'c_1', 'renewal', 2500, 'failed')`).run();
    const staleClaim = new Date(Date.now() - ORDER_CLAIM_STALE_MS - 60_000).toISOString();
    db.prepare(`INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, order_claimed_at) VALUES ('off_recovery', 'c_1', 'be_recovery', 'partial_credit', 2000, 'accepted', ?)`).run(staleClaim);

    vi.mocked(paypal.createOrder).mockResolvedValue({ id: 'mock_order_recovered', status: 'CREATED' });

    const orderId = await createOrderInternal('off_recovery');

    expect(orderId).toBe('mock_order_recovered');
    expect(paypal.createOrder).toHaveBeenCalledTimes(1);
    const row = db.prepare(`SELECT paypal_order_id, order_claimed_at FROM offers WHERE id = 'off_recovery'`).get() as any;
    expect(row.paypal_order_id).toBe('mock_order_recovered');
    expect(row.order_claimed_at).toBeNull();
  });

  it('D4: fresh order claim held by another request is not stolen', async () => {
    const db = getDb();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_fresh', 'c_1', 'renewal', 2500, 'failed')`).run();
    db.prepare(`INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, order_claimed_at) VALUES ('off_fresh', 'c_1', 'be_fresh', 'partial_credit', 2000, 'accepted', ?)`).run(new Date().toISOString());

    const orderId = await createOrderInternal('off_fresh');

    expect(orderId).toBeNull();
    expect(paypal.createOrder).not.toHaveBeenCalled();
  });
});

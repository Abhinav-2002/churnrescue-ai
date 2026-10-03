import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { POST } from '../src/app/api/offers/[offerId]/capture/route';
import { getDb, resetDb, seedDb } from '../src/lib/db';
import * as paypal from '../src/lib/paypal';

vi.mock('../src/lib/paypal', () => {
  return {
    getOrder: vi.fn(),
    captureOrder: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('fake-token'),
    createOrder: vi.fn(),
    verifyWebhookSignature: vi.fn()
  };
});

describe('Capture Endpoint', () => {
  let db: any;
  beforeEach(() => {
    resetDb();
    db = getDb();
    db.prepare(`UPDATE customers SET status = 'at_risk' WHERE id = 'c_1'`).run();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 2500, 'failed')`).run();
    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, expires_at, paypal_order_id)
      VALUES ('off_1', 'c_1', 'be_1', 'partial_credit', 2000, 'accepted', ?, 'pay_1')
    `).run(new Date(Date.now() + 100000).toISOString());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects if amount mismatch before capture', async () => {
    vi.mocked(paypal.getOrder).mockResolvedValue({
      status: 'APPROVED',
      purchase_units: [{ amount: { value: '25.00' } }]
    } as any);

    const req = { json: async () => ({ amount: 2000 }) } as any; // body amount ignored!
    const res = await POST(req, { params: { offerId: 'off_1' } });
    const data = await res.json();
    
    expect(res.status).toBe(400);
    expect(data.error).toContain('Amount mismatch');
  });

  it('rejects if expired offer', async () => {
    db.prepare(`UPDATE offers SET expires_at = ? WHERE id = 'off_1'`).run(new Date(Date.now() - 10000).toISOString());
    const req = { json: async () => ({}) } as any;
    const res = await POST(req, { params: { offerId: 'off_1' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Offer expired' });
  });

  it('keeps at_risk and marks offer failed if capture declines', async () => {
    vi.mocked(paypal.getOrder).mockResolvedValue({
      status: 'APPROVED',
      purchase_units: [{ amount: { value: '20.00' } }]
    } as any);

    vi.mocked(paypal.captureOrder).mockResolvedValue({
      status: 422,
      body: { name: 'INSTRUMENT_DECLINED' }
    } as any);

    const req = { json: async () => ({}) } as any;
    const res = await POST(req, { params: { offerId: 'off_1' } });
    expect(res.status).toBe(400);

    const customer = db.prepare(`SELECT status FROM customers WHERE id = 'c_1'`).get();
    expect(customer.status).toBe('at_risk');

    const offer = db.prepare(`SELECT status FROM offers WHERE id = 'off_1'`).get();
    expect(offer.status).toBe('failed');
  });

  it('handles already-captured error from PayPal without failing offer', async () => {
    vi.mocked(paypal.getOrder).mockResolvedValueOnce({
      status: 'APPROVED',
      purchase_units: [{ amount: { value: '20.00' } }]
    } as any);

    vi.mocked(paypal.captureOrder).mockResolvedValue({
      status: 422,
      body: { name: 'ORDER_ALREADY_CAPTURED' }
    } as any);

    vi.mocked(paypal.getOrder).mockResolvedValueOnce({
      status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ amount: { value: '20.00' } }] } }]
    } as any);

    const req = { json: async () => ({}) } as any;
    const res = await POST(req, { params: { offerId: 'off_1' } });
    expect(res.status).toBe(200);

    const offer = db.prepare(`SELECT status FROM offers WHERE id = 'off_1'`).get();
    expect(offer.status).toBe('captured');
  });

  it('reconciles COMPLETED order with unfinished DB state without second capture', async () => {
    vi.mocked(paypal.getOrder).mockResolvedValue({
      status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ amount: { value: '20.00' } }] } }]
    } as any);

    const req = { json: async () => ({}) } as any;
    const res = await POST(req, { params: { offerId: 'off_1' } });
    expect(res.status).toBe(200);

    const offer = db.prepare(`SELECT status FROM offers WHERE id = 'off_1'`).get();
    expect(offer.status).toBe('captured');
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });

  it('two simultaneous capture calls: PayPal capture called once, one recovery row, final state recovered', async () => {
    vi.mocked(paypal.getOrder).mockResolvedValue({
      status: 'APPROVED',
      purchase_units: [{ amount: { value: '20.00' } }]
    } as any);

    let captureCalled = 0;
    vi.mocked(paypal.captureOrder).mockImplementation(async () => {
      captureCalled++;
      return {
        status: 201,
        body: {
          purchase_units: [{ payments: { captures: [{ amount: { value: '20.00' } }] } }]
        }
      } as any;
    });

    const req1 = { json: async () => ({}) } as any;
    const req2 = { json: async () => ({}) } as any;
    
    // Fire concurrently
    const [res1, res2] = await Promise.all([
      POST(req1, { params: { offerId: 'off_1' } }),
      POST(req2, { params: { offerId: 'off_1' } })
    ]);

    expect(captureCalled).toBe(1);
    
    // One succeeds, one returns 409 Conflict (since atomic update locked it)
    expect([res1.status, res2.status].sort()).toEqual([200, 409]);

    const recoveriesCount = db.prepare(`SELECT COUNT(*) as c FROM recoveries WHERE billing_event_id = 'be_1'`).get().c;
    expect(recoveriesCount).toBe(1);

    const customer = db.prepare(`SELECT status FROM customers WHERE id = 'c_1'`).get();
    expect(customer.status).toBe('recovered');
  });

  it('is idempotent repeat asserts exactly one row in recoveries', async () => {
    db.prepare(`UPDATE offers SET status = 'captured' WHERE id = 'off_1'`).run();
    db.prepare(`
      INSERT INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id)
      VALUES ('rec_1', 'c_1', 'be_1', 2500, 2000, 'pay_1')
    `).run();

    const req = { json: async () => ({}) } as any;
    const res = await POST(req, { params: { offerId: 'off_1' } });
    expect(res.status).toBe(200);

    const recoveriesCount = db.prepare(`SELECT COUNT(*) as c FROM recoveries WHERE billing_event_id = 'be_1'`).get().c;
    expect(recoveriesCount).toBe(1);
  });
});

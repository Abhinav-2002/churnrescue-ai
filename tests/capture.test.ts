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
    // Setup a customer at risk with a billing event and offer
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

    const req = { json: async () => ({}) } as any;
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

  it('rejects if order not APPROVED', async () => {
    vi.mocked(paypal.getOrder).mockResolvedValue({
      status: 'PAYER_ACTION_REQUIRED',
      purchase_units: [{ amount: { value: '20.00' } }]
    } as any);

    const req = { json: async () => ({}) } as any;
    const res = await POST(req, { params: { offerId: 'off_1' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('expected APPROVED');
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

  it('captures successfully, marks recovered, creates recovery row in one transaction', async () => {
    vi.mocked(paypal.getOrder).mockResolvedValue({
      status: 'APPROVED',
      purchase_units: [{ amount: { value: '20.00' } }]
    } as any);

    vi.mocked(paypal.captureOrder).mockResolvedValue({
      status: 201,
      body: {
        purchase_units: [{ payments: { captures: [{ amount: { value: '20.00' } }] } }]
      }
    } as any);

    const req = { json: async () => ({}) } as any;
    const res = await POST(req, { params: { offerId: 'off_1' } });
    expect(res.status).toBe(200);

    const customer = db.prepare(`SELECT status FROM customers WHERE id = 'c_1'`).get();
    expect(customer.status).toBe('recovered');

    const offer = db.prepare(`SELECT status FROM offers WHERE id = 'off_1'`).get();
    expect(offer.status).toBe('captured');

    const recovery = db.prepare(`SELECT * FROM recoveries WHERE billing_event_id = 'be_1'`).get() as any;
    expect(recovery).toBeDefined();
    expect(recovery.recovered_amount_cents).toBe(2000);
  });

  it('is idempotent for already captured', async () => {
    db.prepare(`UPDATE offers SET status = 'captured' WHERE id = 'off_1'`).run();
    const req = { json: async () => ({}) } as any;
    const res = await POST(req, { params: { offerId: 'off_1' } });
    expect(res.status).toBe(200);
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });

  it('handles pause correctly without paypal order', async () => {
    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, expires_at)
      VALUES ('off_2', 'c_1', 'be_1', 'pause', 0, 'accepted', ?)
    `).run(new Date(Date.now() + 100000).toISOString());

    const req = { json: async () => ({}) } as any;
    const res = await POST(req, { params: { offerId: 'off_2' } });
    expect(res.status).toBe(200);

    const customer = db.prepare(`SELECT status FROM customers WHERE id = 'c_1'`).get();
    expect(customer.status).toBe('paused');
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { POST } from '../src/app/api/offers/[offerId]/capture/route';
import { getDb, resetDb } from '../src/lib/db';
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

  it('order not APPROVED: offer stays accepted, returns not_approved, nothing failed', async () => {
    vi.mocked(paypal.getOrder).mockResolvedValue({
      status: 'PAYER_ACTION_REQUIRED'
    } as any);

    const req = { headers: new Headers({"x-forwarded-for": "127.0.0.1"}), json: async () => ({}) } as any;
    const res = await POST(req, { params: { offerId: 'off_1' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'not_approved' });

    const offer = db.prepare(`SELECT status FROM offers WHERE id = 'off_1'`).get();
    expect(offer.status).toBe('accepted');
  });

  it('successful capture: recovery row, offer captured, customer recovered, billing event recovered, in one transaction', async () => {
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

    const req = { headers: new Headers({"x-forwarded-for": "127.0.0.1"}), json: async () => ({}) } as any;
    const res = await POST(req, { params: { offerId: 'off_1' } });
    expect(res.status).toBe(200);

    const customer = db.prepare(`SELECT status FROM customers WHERE id = 'c_1'`).get() as any;
    expect(customer.status).toBe('recovered');

    const offer = db.prepare(`SELECT status, paypal_order_status FROM offers WHERE id = 'off_1'`).get() as any;
    expect(offer.status).toBe('captured');
    expect(offer.paypal_order_status).toBe('captured');

    const billingEvent = db.prepare(`SELECT status FROM billing_events WHERE id = 'be_1'`).get();
    expect(billingEvent.status).toBe('recovered');

    const recovery = db.prepare(`SELECT * FROM recoveries WHERE billing_event_id = 'be_1'`).get() as any;
    expect(recovery).toBeDefined();
    expect(recovery.recovered_amount_cents).toBe(2000);
  });

  it('repeat call after success returns success', async () => {
    db.prepare(`UPDATE offers SET status = 'captured' WHERE id = 'off_1'`).run();
    
    const req = { headers: new Headers({"x-forwarded-for": "127.0.0.1"}), json: async () => ({}) } as any;
    const res = await POST(req, { params: { offerId: 'off_1' } });
    
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, status: 'captured' });
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });

  it('crash recovery: offer capturing older than 2 minutes with a COMPLETED PayPal order and an expired offer is reconciled without a second capture', async () => {
    db.prepare(`UPDATE offers SET status = 'capturing', capturing_at = ?, expires_at = ? WHERE id = 'off_1'`)
      .run(new Date(Date.now() - 130000).toISOString(), new Date(Date.now() - 10000).toISOString());

    vi.mocked(paypal.getOrder).mockResolvedValue({
      status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ amount: { value: '20.00' } }] } }]
    } as any);

    const req = { headers: new Headers({"x-forwarded-for": "127.0.0.1"}), json: async () => ({}) } as any;
    const res = await POST(req, { params: { offerId: 'off_1' } });
    expect(res.status).toBe(200);
    
    const offer = db.prepare(`SELECT status FROM offers WHERE id = 'off_1'`).get();
    expect(offer.status).toBe('captured');
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });

  it('get-order throws: offer reverted to accepted, not stuck in capturing', async () => {
    vi.mocked(paypal.getOrder).mockRejectedValue(new Error('Network error'));
    
    const req = { headers: new Headers({"x-forwarded-for": "127.0.0.1"}), json: async () => ({}) } as any;
    const res = await POST(req, { params: { offerId: 'off_1' } });
    
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('get_order_failed');

    const offer = db.prepare(`SELECT status, capturing_at FROM offers WHERE id = 'off_1'`).get() as any;
    expect(offer.status).toBe('accepted');
    expect(offer.capturing_at).toBeNull();
  });

  it('two simultaneous calls: PayPal capture called once, one recovery row; loser gets in_progress or success, never failed', async () => {
    vi.mocked(paypal.getOrder).mockResolvedValue({
      status: 'APPROVED',
      purchase_units: [{ amount: { value: '20.00' } }]
    } as any);

    let captureCount = 0;
    vi.mocked(paypal.captureOrder).mockImplementation(async () => {
      captureCount++;
      return {
        status: 201,
        body: {
          purchase_units: [{ payments: { captures: [{ amount: { value: '20.00' } }] } }]
        }
      } as any;
    });

    const req1 = { headers: new Headers({"x-forwarded-for": "127.0.0.1"}), json: async () => ({}) } as any;
    const req2 = { headers: new Headers({"x-forwarded-for": "127.0.0.1"}), json: async () => ({}) } as any;
    
    const [res1, res2] = await Promise.all([
      POST(req1, { params: { offerId: 'off_1' } }),
      POST(req2, { params: { offerId: 'off_1' } })
    ]);

    expect(captureCount).toBe(1);
    
    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const loserRes = statuses[1] === res1.status ? res1 : res2;
    const json = await (loserRes as any).json().catch(() => ({}));
    if (loserRes.status === 409) expect(json.error).toBe('in_progress');

    const recoveriesCount = db.prepare(`SELECT COUNT(*) as c FROM recoveries WHERE billing_event_id = 'be_1'`).get().c;
    expect(recoveriesCount).toBe(1);
  });

  it('client-supplied amount in body and query string is ignored', async () => {
    vi.mocked(paypal.getOrder).mockResolvedValue({
      status: 'APPROVED',
      purchase_units: [{ amount: { value: '25.00' } }] // 25.00 mismatch with 20.00 offer
    } as any);

    const req = { headers: new Headers({"x-forwarded-for": "127.0.0.1"}), json: async () => ({ amount: 2500 }), url: 'http://localhost/capture?amount=2500' } as any; 
    const res = await POST(req, { params: { offerId: 'off_1' } });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('amount_mismatch');
  });

  it('decline response contains no PayPal body fields', async () => {
    vi.mocked(paypal.getOrder).mockResolvedValue({
      status: 'APPROVED',
      purchase_units: [{ amount: { value: '20.00' } }]
    } as any);

    vi.mocked(paypal.captureOrder).mockResolvedValue({
      status: 422,
      body: { name: 'INSTRUMENT_DECLINED', sensitive_info: 'secret' }
    } as any);

    const req = { headers: new Headers({"x-forwarded-for": "127.0.0.1"}), json: async () => ({}) } as any;
    const res = await POST(req, { params: { offerId: 'off_1' } });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toEqual({ error: 'declined' }); // NO body fields
    
    const offer = db.prepare(`SELECT status FROM offers WHERE id = 'off_1'`).get();
    expect(offer.status).toBe('failed');
  });

  it('UNIQUE constraint: inserting a second recovery for the same order fails or is ignored', async () => {
    db.prepare(`
      INSERT INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id)
      VALUES ('rec_1', 'c_1', 'be_1', 2500, 2000, 'pay_1')
    `).run();

    vi.mocked(paypal.getOrder).mockResolvedValue({
      status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ amount: { value: '20.00' } }] } }]
    } as any);

    const req = { headers: new Headers({"x-forwarded-for": "127.0.0.1"}), json: async () => ({}) } as any;
    const res = await POST(req, { params: { offerId: 'off_1' } });
    expect(res.status).toBe(200);

    const recoveriesCount = db.prepare(`SELECT COUNT(*) as c FROM recoveries WHERE billing_event_id = 'be_1'`).get().c;
    expect(recoveriesCount).toBe(1);
  });

  it('capture throws after PayPal actually captured, then retry after offer expired -> reconciled, 1 recovery row, no second capture', async () => {
    vi.mocked(paypal.getOrder).mockResolvedValueOnce({
      status: 'APPROVED',
      purchase_units: [{ amount: { value: '20.00' } }]
    } as any);

    vi.mocked(paypal.captureOrder).mockRejectedValueOnce(new Error('Network drop after capture'));

    const req1 = { headers: new Headers({"x-forwarded-for": "127.0.0.1"}), json: async () => ({}) } as any;
    const res1 = await POST(req1, { params: { offerId: 'off_1' } });
    expect(res1.status).toBe(500);

    let offer = db.prepare(`SELECT status FROM offers WHERE id = 'off_1'`).get() as any;
    expect(offer.status).toBe('capturing'); // Left in capturing

    db.prepare(`UPDATE offers SET expires_at = ? WHERE id = 'off_1'`).run(new Date(Date.now() - 10000).toISOString());
    // Age it to simulate crash recovery
    db.prepare(`UPDATE offers SET capturing_at = ? WHERE id = 'off_1'`).run(new Date(Date.now() - 130000).toISOString());

    vi.mocked(paypal.getOrder).mockResolvedValueOnce({
      status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ amount: { value: '20.00' } }] } }]
    } as any);

    const req2 = { headers: new Headers({"x-forwarded-for": "127.0.0.1"}), json: async () => ({}) } as any;
    const res2 = await POST(req2, { params: { offerId: 'off_1' } });
    expect(res2.status).toBe(200);

    offer = db.prepare(`SELECT status FROM offers WHERE id = 'off_1'`).get() as any;
    expect(offer.status).toBe('captured');
    
    // captureOrder only called ONCE total
    expect(paypal.captureOrder).toHaveBeenCalledTimes(1);
  });
});

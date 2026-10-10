import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST as capturePOST } from '../src/app/api/offers/[offerId]/capture/route';
import { POST as messagePOST } from '../src/app/api/agent/message/route';
import { POST as startPOST } from '../src/app/api/agent/start/route';
import { GET as metricsGET } from '../src/app/api/dashboard/metrics/route';
import { getDb, resetDb } from '../src/lib/db';
import * as paypal from '../src/lib/paypal';
import { resetRateLimitsForTests, tryConsumeLlmRun } from '../src/lib/rate-limit';

vi.mock('../src/lib/paypal', () => ({
  getOrder: vi.fn(),
  captureOrder: vi.fn(),
  createOrder: vi.fn().mockResolvedValue({ id: 'new_order_123', status: 'CREATED' }),
}));

describe('Systematic Probing', () => {
  beforeEach(() => {
    resetDb();
    resetRateLimitsForTests();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('no defect found: two simultaneous captures', async () => {
    const db = getDb();
    db.prepare(`UPDATE customers SET status = 'at_risk' WHERE id = 'c_1'`).run();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 2500, 'failed')`).run();
    db.prepare(`INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, paypal_order_id, expires_at) VALUES ('off_1', 'c_1', 'be_1', 'partial_credit', 2000, 'accepted', 'order_1', ?)`).run(new Date(Date.now() + 86400000).toISOString());
    
    vi.mocked(paypal.getOrder).mockResolvedValue({ status: 'APPROVED', purchase_units: [{ amount: { value: '20.00' } }] } as any);
    vi.mocked(paypal.captureOrder).mockResolvedValue({ status: 201, body: { purchase_units: [{ payments: { captures: [{ amount: { value: '20.00' } }] } }] } } as any);

    const req1 = new Request('http://localhost/api/offers/off_1/capture', { method: 'POST' });
    const req2 = new Request('http://localhost/api/offers/off_1/capture', { method: 'POST' });
    
    const [res1, res2] = await Promise.all([
      capturePOST(req1, { params: Promise.resolve({ offerId: 'off_1' }) }),
      capturePOST(req2, { params: Promise.resolve({ offerId: 'off_1' }) })
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('no defect found: expired offer', async () => {
    const db = getDb();
    db.prepare(`UPDATE customers SET status = 'at_risk' WHERE id = 'c_1'`).run();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 2500, 'failed')`).run();
    db.prepare(`INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, paypal_order_id, expires_at) VALUES ('off_exp', 'c_1', 'be_1', 'partial_credit', 2000, 'accepted', 'order_exp', ?)`).run(new Date(Date.now() - 1000).toISOString());
    
    vi.mocked(paypal.getOrder).mockResolvedValue({ status: 'APPROVED' } as any);

    const req = new Request('http://localhost/api/offers/off_exp/capture', { method: 'POST' });
    const res = await capturePOST(req, { params: Promise.resolve({ offerId: 'off_exp' }) });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('expired');
  });

  it('no defect found: amount mismatch', async () => {
    const db = getDb();
    db.prepare(`UPDATE customers SET status = 'at_risk' WHERE id = 'c_1'`).run();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 2500, 'failed')`).run();
    db.prepare(`INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, paypal_order_id, expires_at) VALUES ('off_mis', 'c_1', 'be_1', 'partial_credit', 2000, 'accepted', 'order_mis', ?)`).run(new Date(Date.now() + 86400000).toISOString());
    
    // DB expects 2000 ($20.00), paypal says $10.00
    vi.mocked(paypal.getOrder).mockResolvedValue({ status: 'APPROVED', purchase_units: [{ amount: { value: '10.00' } }] } as any);

    const req = new Request('http://localhost/api/offers/off_mis/capture', { method: 'POST' });
    const res = await capturePOST(req, { params: Promise.resolve({ offerId: 'off_mis' }) });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('amount_mismatch');
    
    const offer = db.prepare('SELECT status FROM offers WHERE id = ?').get('off_mis') as any;
    expect(offer.status).toBe('needs_review');
  });

  it('no defect found: reload mid-payment', async () => {
    const db = getDb();
    db.prepare(`UPDATE customers SET status = 'at_risk' WHERE id = 'c_1'`).run();
    // Offer is stuck in 'capturing' from 1 minute ago
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 2500, 'failed')`).run();
    db.prepare(`INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, paypal_order_id, expires_at, capturing_at) VALUES ('off_rel', 'c_1', 'be_1', 'partial_credit', 2000, 'capturing', 'order_rel', ?, ?)`).run(new Date(Date.now() + 86400000).toISOString(), new Date(Date.now() - 60000).toISOString());
    
    const req = new Request('http://localhost/api/offers/off_rel/capture', { method: 'POST' });
    const res = await capturePOST(req, { params: Promise.resolve({ offerId: 'off_rel' }) });
    
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe('in_progress');
  });

  it('no defect found: error responses never leak message text', async () => {
    const req = new Request('http://localhost/api/agent/message', {
      method: 'POST',
      body: JSON.stringify({ customerId: 'c_1', text: 'make it throw' }),
      headers: new Headers({ 'x-forwarded-for': '127.0.0.1' })
    });
    // Will throw because customer c_1 has no billing events in memory right now!
    const res = await messagePOST(req);
    const data = await res.json();
    expect(data.reply || data.error || data.busy).toBeTruthy();
    
    expect(JSON.stringify(data)).not.toContain('throw');
  });

  it('no defect found: log redaction (no secret leaking in console.error)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = new Request('http://localhost/api/agent/message', {
      method: 'POST',
      body: JSON.stringify({ customerId: 'c_1', text: 'my credit card is 4111222233334444' }),
      headers: new Headers({ 'x-forwarded-for': '127.0.0.1' })
    });
    await messagePOST(req);
    
    // DB doesn't redact, but console.error logs shouldn't leak the exact error?
    // Wait, the prompt says: "a secret-looking string in a request never appears in logs"
    const calls = spy.mock.calls.map(c => c.join(' ')).join(' ');
    expect(calls).not.toContain('4111222233334444');
    spy.mockRestore();
  });

  it('no defect found: bad LLM_MODEL returns safe fallback', async () => {
    const origModel = process.env.LLM_MODEL;
    process.env.LLM_MODEL = 'invalid-model-name-123';
    
    getDb().prepare(`UPDATE customers SET status = 'at_risk' WHERE id = 'c_1'`).run();
    getDb().prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_m', 'c_1', 'renewal', 2500, 'failed')`).run();

    const req = new Request('http://localhost/api/agent/start', {
      method: 'POST',
      body: JSON.stringify({ customerId: 'c_1' }),
      headers: new Headers({ 'x-forwarded-for': '127.0.0.1' })
    });
    const res = await startPOST(req);
    const data = await res.json();
    
    expect(data.reply || data.error || data.busy).toBeTruthy();
    
    process.env.LLM_MODEL = origModel;
  });

  it('no defect found: LLM budget exhaustion', async () => {
    getDb().prepare(`UPDATE customers SET status = 'at_risk' WHERE id = 'c_1'`).run();
    getDb().prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_b', 'c_1', 'renewal', 2500, 'failed')`).run();
    // Consume budget
    for (let i = 0; i < 500; i++) {
      tryConsumeLlmRun();
    }
    
    const req = new Request('http://localhost/api/agent/start', {
      method: 'POST',
      body: JSON.stringify({ customerId: 'c_1' }),
      headers: new Headers({ 'x-forwarded-for': '127.0.0.1' })
    });
    const res = await startPOST(req);
    const data = await res.json();
    
    expect(data.reply).toContain("busy");
  });

  it('no defect found: dashboard invariants', async () => {
    const db = getDb();
    // 1 failed, 1 recovered
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_i1', 'c_1', 'renewal', 2500, 'failed')`).run();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_i2', 'c_1', 'renewal', 2500, 'recovered')`).run();
    
    // Mix
    db.prepare(`INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json) VALUES ('act_1', 'c_1', 'be_i1', 'retry', 'test', '{}')`).run();
    
    // Corrupted offer row
    db.prepare(`INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, discount_percent, ladder_step, target_plan, status) VALUES ('off_corrupt', 'c_1', 'be_i1', 'pause', 5000, null, 0, null, 'pending')`).run();
    
    const req = new Request('http://localhost/api/dashboard/metrics');
    const res = await metricsGET(req);
    const data = await res.json();
    
    // recovered <= failed
    expect(data.funnel.paid).toBeLessThanOrEqual(data.funnel.failed);
    // funnel non-increasing
    expect(data.funnel.offered).toBeLessThanOrEqual(data.funnel.failed);
    expect(data.funnel.accepted).toBeLessThanOrEqual(data.funnel.offered);
    expect(data.funnel.paid).toBeLessThanOrEqual(data.funnel.accepted);
    // mix sums to total
    const mixSum = data.intervention_mix.retry + data.intervention_mix.pause + data.intervention_mix.credit + data.intervention_mix.downgrade + data.intervention_mix.escalate;
    console.log('MIX:', data.intervention_mix); expect(mixSum).toBe(data.intervention_mix.total_interventions);
    // policy audit reports 1 for a deliberately corrupted offer row
    expect(data.policy_audit.outside_policy_count).toBe(1);
    expect(data.policy_audit.violating_offer_ids).toContain('off_corrupt');
  });

  it('no defect found: rate limits per route', async () => {
    // Make 11 requests
    let lastRes;
    for(let i=0; i<61; i++) {
      lastRes = await startPOST(new Request('http://localhost/api/agent/start', {
        method: 'POST', body: JSON.stringify({ customerId: 'c_1' }),
        headers: new Headers({ 'x-forwarded-for': '127.0.0.99' })
      }));
    }
    expect(lastRes?.status).toBe(429);
  });

  it('Defect 7: PayPal decline then re-accept gets stuck', async () => {
    const db = getDb();
    db.prepare(`UPDATE customers SET status = 'at_risk' WHERE id = 'c_1'`).run();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_d7', 'c_1', 'renewal', 2500, 'failed')`).run();
    
    // 1. First offer is made
    db.prepare(`INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, paypal_order_id, expires_at) VALUES ('off_d7_1', 'c_1', 'be_d7', 'partial_credit', 2000, 'accepted', 'order_d7_1', ?)`).run(new Date(Date.now() + 86400000).toISOString());
    
    // 2. Capture fails (INSTRUMENT_DECLINED)
    vi.mocked(paypal.getOrder).mockResolvedValue({ status: 'APPROVED', purchase_units: [{ amount: { value: '20.00' } }] } as any);
    vi.mocked(paypal.captureOrder).mockResolvedValue({ status: 422, body: { details: [{ issue: 'INSTRUMENT_DECLINED' }] } } as any);

    const captureReq = new Request('http://localhost/api/offers/off_d7_1/capture', { method: 'POST' });
    await capturePOST(captureReq, { params: Promise.resolve({ offerId: 'off_d7_1' }) });
    
    // Check it's failed
    const offerAfter = db.prepare('SELECT status FROM offers WHERE id = ?').get('off_d7_1') as any;
    expect(offerAfter.status).toBe('failed');
    
    // 3. User clicks "yes" again (or says yes in chat)
    // We mock graph to return intent: accept
    vi.doMock('../src/lib/agent/graph', () => ({
      graph: {
        invoke: vi.fn().mockResolvedValue({
          intent: 'accept',
          messages: [{ content: 'OK' }]
        })
      }
    }));
    
    const msgReq = new Request('http://localhost/api/agent/message', {
      method: 'POST',
      body: JSON.stringify({ customerId: 'c_1', text: 'yes I will pay' }),
      headers: new Headers({ 'x-forwarded-for': '127.0.0.1' })
    });
    await messagePOST(msgReq);
    
    // 4. Assert a NEW order was created!
    const activeOffers = db.prepare('SELECT * FROM offers WHERE customer_id = ? AND status = ?').all('c_1', 'accepted') as any[];
    expect(activeOffers.length).toBe(1);
    expect(activeOffers[0].paypal_order_id).toBe('new_order_123');
  });
});

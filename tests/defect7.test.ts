import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST as messagePOST } from '../src/app/api/agent/message/route';
import { POST as capturePOST } from '../src/app/api/offers/[offerId]/capture/route';
import { getDb, resetDb } from '../src/lib/db';
import * as paypal from '../src/lib/paypal';
import { resetRateLimitsForTests } from '../src/lib/rate-limit';
import { AIMessage } from '@langchain/core/messages';

// Mocks never touch the network: every PayPal call is a vi.fn().
vi.mock('../src/lib/paypal', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    getOrder: vi.fn(),
    captureOrder: vi.fn(),
    createOrder: vi.fn(),
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

function seedDeclinedCapture() {
  const db = getDb();
  db.prepare(`UPDATE customers SET status = 'at_risk' WHERE id = 'c_1'`).run();
  db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_d7', 'c_1', 'renewal', 2500, 'failed')`).run();
  db.prepare(`
    INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, ladder_step, paypal_order_id, paypal_order_status, expires_at)
    VALUES ('off_d7_1', 'c_1', 'be_d7', 'partial_credit', 1625, 'accepted', 1, 'order_d7_1', 'approved', ?)
  `).run(new Date(Date.now() + 86_400_000).toISOString());

  vi.mocked(paypal.getOrder).mockResolvedValue({ status: 'APPROVED', purchase_units: [{ amount: { value: '16.25' } }] } as any);
  vi.mocked(paypal.captureOrder).mockResolvedValue({ status: 422, body: { details: [{ issue: 'INSTRUMENT_DECLINED' }] } } as any);
  return db;
}

describe('Defect 7: decline then re-accept', () => {
  beforeEach(() => {
    resetDb();
    resetRateLimitsForTests();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('D7: replacement offer after decline keeps ladder_step and amount (no ladder reset)', async () => {
    const db = seedDeclinedCapture();

    const res = await capturePOST(
      new Request('http://localhost/api/offers/off_d7_1/capture', { method: 'POST' }),
      { params: Promise.resolve({ offerId: 'off_d7_1' }) }
    );
    expect((await res.json()).error).toBe('declined');

    const old = db.prepare(`SELECT status FROM offers WHERE id = 'off_d7_1'`).get() as any;
    expect(old.status).toBe('failed');

    const replacements = db.prepare(`SELECT * FROM offers WHERE customer_id = 'c_1' AND id != 'off_d7_1'`).all() as any[];
    expect(replacements).toHaveLength(1);
    expect(replacements[0].status).toBe('pending');
    expect(replacements[0].ladder_step).toBe(1);
    expect(replacements[0].amount_cents).toBe(1625);
    expect(replacements[0].paypal_order_id).toBeNull();

    const maxStep = db.prepare(`SELECT MAX(ladder_step) AS m FROM offers WHERE customer_id = 'c_1'`).get() as any;
    expect(maxStep.m).toBe(1);
  });

  it('D7: next accept after decline creates a NEW PayPal order with a new Request-Id', async () => {
    const db = seedDeclinedCapture();

    await capturePOST(
      new Request('http://localhost/api/offers/off_d7_1/capture', { method: 'POST' }),
      { params: Promise.resolve({ offerId: 'off_d7_1' }) }
    );
    const replacement = db.prepare(`SELECT id FROM offers WHERE customer_id = 'c_1' AND status = 'pending'`).get() as any;
    expect(replacement).toBeDefined();

    vi.mocked(paypal.createOrder).mockResolvedValue({ id: 'order_d7_2', status: 'CREATED' } as any);

    const msgRes = await messagePOST({
      json: async () => ({ customerId: 'c_1', text: 'yes, try again' }),
      headers: new Headers({ 'x-forwarded-for': '127.0.0.1' })
    } as any);
    const body = await msgRes.json();

    expect(paypal.createOrder).toHaveBeenCalledTimes(1);
    const requestId = vi.mocked(paypal.createOrder).mock.calls[0][3];
    expect(requestId).toBe(`offer_${replacement.id}`);
    expect(requestId).not.toBe('offer_off_d7_1');
    expect(vi.mocked(paypal.createOrder).mock.calls[0][0]).toBe(1625);
    expect(body.orderId).toBe('order_d7_2');

    const accepted = db.prepare(`SELECT paypal_order_id, ladder_step FROM offers WHERE id = ?`).get(replacement.id) as any;
    expect(accepted.paypal_order_id).toBe('order_d7_2');
    expect(accepted.ladder_step).toBe(1);
  });
});

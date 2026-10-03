import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '../src/app/api/agent/state/route';
import { getDb, resetDb } from '../src/lib/db';

describe('State Endpoint', () => {
  let db: any;
  beforeEach(() => {
    resetDb();
    db = getDb();
    db.prepare(`UPDATE customers SET status = 'at_risk' WHERE id = 'c_1'`).run();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 2500, 'failed')`).run();
  });

  const makeReq = (url: string) => ({ url } as any);

  it('returns nextStep none and empty messages if no data', async () => {
    const res = await GET(makeReq('http://localhost/api/agent/state?customerId=c_1'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.nextStep).toBe('none');
    expect(data.messages).toEqual([]);
    expect(data.customer.status).toBe('at_risk');
  });

  it('returns nextStep pay for accepted offer with orderId and amount > 0', async () => {
    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, paypal_order_id)
      VALUES ('off_1', 'c_1', 'be_1', 'partial_credit', 2000, 'accepted', 'pay_1')
    `).run();

    const res = await GET(makeReq('http://localhost/api/agent/state?customerId=c_1'));
    const data = await res.json();
    expect(data.nextStep).toBe('pay');
    expect(data.offerId).toBe('off_1');
    expect(data.orderId).toBe('pay_1');
    expect(data.amountCents).toBe(2000);
  });

  it('returns nextStep confirm_pause for pending pause offer', async () => {
    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status)
      VALUES ('off_1', 'c_1', 'be_1', 'pause', 0, 'pending')
    `).run();

    const res = await GET(makeReq('http://localhost/api/agent/state?customerId=c_1'));
    const data = await res.json();
    expect(data.nextStep).toBe('confirm_pause');
    expect(data.offerId).toBe('off_1');
    expect(data.orderId).toBeUndefined();
  });

  it('returns nextStep escalated if agent_actions has escalate row', async () => {
    db.prepare(`INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json) VALUES ('act_1', 'c_1', 'be_1', 'escalate', 'test', '{}')`).run();

    const res = await GET(makeReq('http://localhost/api/agent/state?customerId=c_1'));
    const data = await res.json();
    expect(data.nextStep).toBe('escalated');
  });

  it('returns 400 if validation fails', async () => {
    const res = await GET(makeReq('http://localhost/api/agent/state'));
    expect(res.status).toBe(400);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from '../src/app/api/agent/confirm-pause/route';
import { getDb, resetDb } from '../src/lib/db';

describe('Confirm Pause Endpoint', () => {
  let db: any;
  beforeEach(() => {
    resetDb();
    db = getDb();
    db.prepare(`UPDATE customers SET status = 'at_risk' WHERE id = 'c_1'`).run();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 2500, 'failed')`).run();
  });

  it('rejects if offer is not pause', async () => {
    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, expires_at)
      VALUES ('off_1', 'c_1', 'be_1', 'partial_credit', 2000, 'pending', ?)
    `).run(new Date(Date.now() + 100000).toISOString());

    const req = { json: async () => ({ customerId: 'c_1', offerId: 'off_1' }) } as any;
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Not a pause offer' });
  });

  it('rejects if offer is expired', async () => {
    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, expires_at)
      VALUES ('off_1', 'c_1', 'be_1', 'pause', 0, 'pending', ?)
    `).run(new Date(Date.now() - 100000).toISOString());

    const req = { json: async () => ({ customerId: 'c_1', offerId: 'off_1' }) } as any;
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Offer expired' });
  });

  it('rejects if offer is failed (declined)', async () => {
    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, expires_at)
      VALUES ('off_1', 'c_1', 'be_1', 'pause', 0, 'failed', ?)
    `).run(new Date(Date.now() + 100000).toISOString());

    const req = { json: async () => ({ customerId: 'c_1', offerId: 'off_1' }) } as any;
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Offer is not pending or accepted' });
  });

  it('accepts and pauses if valid', async () => {
    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, expires_at)
      VALUES ('off_1', 'c_1', 'be_1', 'pause', 0, 'pending', ?)
    `).run(new Date(Date.now() + 100000).toISOString());

    const req = { json: async () => ({ customerId: 'c_1', offerId: 'off_1' }) } as any;
    const res = await POST(req);
    expect(res.status).toBe(200);
    
    const customer = db.prepare(`SELECT status FROM customers WHERE id = 'c_1'`).get();
    expect(customer.status).toBe('paused');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_recovery_order } from '../src/lib/agent/tools';
import { getDb, seedDb } from '../src/lib/db';

describe('tools', () => {
  beforeEach(() => {
    process.env.SQLITE_PATH = ':memory:';
    const db = getDb();
    db.exec('DELETE FROM offers; DELETE FROM billing_events; DELETE FROM customers; DELETE FROM conversations;');
    seedDb();
  });

  it('create_recovery_order rejects any input except offerId (schema test)', () => {
    const schema = create_recovery_order.schema;
    
    // valid
    expect(schema.safeParse({ offerId: 'off_1' }).success).toBe(true);
    
    // invalid (missing offerId)
    expect(schema.safeParse({ amount: 100 }).success).toBe(false);
  });

  it('an expired offer cannot create an order', async () => {
    const db = getDb();
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run(
      'evt_test', 'c_1', 'renewal', 2500, 'failed'
    );
    
    const offerId = 'off_exp';
    const expiredTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    
    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(offerId, 'c_1', 'evt_test', 'partial_credit', 2000, expiredTime, 'accepted');

    const result = await create_recovery_order.invoke({ offerId }, { configurable: { customerId: 'c_1' } });
    
    expect(result).toContain('Offer has expired');
  });
});

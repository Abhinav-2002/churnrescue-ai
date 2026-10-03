import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, resetDb } from '@/lib/db';
import { GET } from '@/app/api/dashboard/route';

describe('Dashboard API', () => {
  beforeEach(() => {
    resetDb();
  });

  it('should return correct totals and recovery rate math after a seeded recovery', async () => {
    const db = getDb();
    
    // Seed a failed billing event and a recovery
    const customerId = 'c_1';
    const eventId = 'be_test';
    
    db.prepare(`
      INSERT INTO billing_events (id, customer_id, type, amount_cents, status, paypal_order_id, paypal_error_code, idempotency_key)
      VALUES (?, ?, 'renewal', 5000, 'failed', 'order_1', 'ERROR', 'key_1')
    `).run(eventId, customerId);

    db.prepare(`
      INSERT INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id)
      VALUES ('rec_1', ?, ?, 5000, 4000, 'order_rec_1')
    `).run(customerId, eventId);

    // Call API
    const response = await GET();
    const data = await response.json();

    expect(data.summary.totalFailedAmount).toBe(5000);
    expect(data.summary.totalRecoveredAmount).toBe(4000);
    expect(data.summary.recoveryRate).toBe(4000 / 5000);
  });

  it('should not expose PayPal order bodies or secrets', async () => {
    const response = await GET();
    const data = await response.json();
    
    const strData = JSON.stringify(data).toLowerCase();
    expect(strData).not.toContain('paypal_order_id');
    expect(strData).not.toContain('client_id');
    expect(strData).not.toContain('secret');
  });
});

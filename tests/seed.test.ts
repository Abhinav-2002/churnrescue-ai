import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, resetDb } from '@/lib/db';

describe('Database Seed and Reset', () => {
  beforeEach(() => {
    // Ensures the DB is initialized and seeded
    resetDb();
  });

  it('should seed exactly 8 customers', () => {
    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) as c FROM customers').get() as { c: number };
    expect(count.c).toBe(8);
  });

  it('should restore original state after reset', () => {
    const db = getDb();
    
    // Modify a customer
    db.prepare("UPDATE customers SET status = 'at_risk' WHERE id = 'c_1'").run();
    let c1 = db.prepare("SELECT status FROM customers WHERE id = 'c_1'").get() as any;
    expect(c1.status).toBe('at_risk');

    // Reset the database
    resetDb();

    // Verify it's back to healthy
    c1 = db.prepare("SELECT status FROM customers WHERE id = 'c_1'").get() as any;
    expect(c1.status).toBe('healthy');
    
    // Verify count is still 8
    const count = db.prepare('SELECT COUNT(*) as c FROM customers').get() as { c: number };
    expect(count.c).toBe(8);
  });
});

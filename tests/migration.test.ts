import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS, getDb } from '../src/lib/db';

describe('Database Migration', () => {
  let tempDb: Database.Database;

  beforeEach(() => {
    // We mock process.env.SQLITE_PATH to create an isolated DB via getDb()
    process.env.SQLITE_PATH = ':memory:';
    globalThis._sqliteDb = undefined;
    globalThis._migrationsRun = undefined;

    tempDb = new Database(':memory:');
    tempDb.pragma('foreign_keys = ON');

    tempDb.exec(`
      CREATE TABLE customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        plan_name TEXT NOT NULL,
        plan_price_cents INTEGER NOT NULL CHECK(plan_price_cents >= 0),
        usage_percent INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('healthy', 'at_risk', 'recovered', 'paused')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE billing_events (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
        status TEXT NOT NULL CHECK(status IN ('failed', 'recovered')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(customer_id) REFERENCES customers(id)
      );
      
      CREATE TABLE offers (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        billing_event_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
        status TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(customer_id) REFERENCES customers(id),
        FOREIGN KEY(billing_event_id) REFERENCES billing_events(id)
      );
    `);
    
    // Set the global db directly so getDb() just runs migrations
    globalThis._sqliteDb = tempDb;
  });

  afterEach(() => {
    tempDb.close();
    globalThis._sqliteDb = undefined;
    globalThis._migrationsRun = undefined;
    delete process.env.SQLITE_PATH;
  });

  it('runs the init/migration and asserts every expected column exists', () => {
    // Calling getDb() will trigger migrations because _migrationsRun is undefined
    const db = getDb();

    const cols = db.prepare('PRAGMA table_info(offers)').all() as { name: string }[];
    const colNames = cols.map(c => c.name);

    for (const m of MIGRATIONS) {
      expect(colNames).toContain(m.name);
    }
    
    expect(colNames).toContain('capturing_at');
    expect(colNames).toContain('paypal_order_id');
  });
});

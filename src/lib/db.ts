import Database from 'better-sqlite3';
import path from 'path';

let db: Database.Database;

export function getDb() {
  if (!db) {
    // Determine path based on environment
    const dbPath = process.env.NODE_ENV === 'test' 
      ? ':memory:' 
      : path.join(process.cwd(), 'data.db');
      
    db = new Database(dbPath);
    // Enforce foreign keys
    db.pragma('foreign_keys = ON');
    
    initDb();
  }
  return db;
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      plan_name TEXT NOT NULL,
      plan_price_cents INTEGER NOT NULL CHECK(plan_price_cents >= 0),
      usage_percent INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('healthy', 'at_risk', 'recovered', 'paused')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS billing_events (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
      status TEXT NOT NULL,
      paypal_order_id TEXT,
      paypal_error_code TEXT,
      idempotency_key TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS offers (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      billing_event_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('retry', 'partial_credit', 'downgrade', 'pause')),
      amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
      expires_at DATETIME,
      status TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id) REFERENCES customers(id),
      FOREIGN KEY(billing_event_id) REFERENCES billing_events(id)
    );

    CREATE TABLE IF NOT EXISTS agent_actions (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      billing_event_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id) REFERENCES customers(id),
      FOREIGN KEY(billing_event_id) REFERENCES billing_events(id)
    );

    CREATE TABLE IF NOT EXISTS recoveries (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      billing_event_id TEXT NOT NULL,
      original_amount_cents INTEGER NOT NULL CHECK(original_amount_cents >= 0),
      recovered_amount_cents INTEGER NOT NULL CHECK(recovered_amount_cents >= 0),
      paypal_order_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id) REFERENCES customers(id),
      FOREIGN KEY(billing_event_id) REFERENCES billing_events(id)
    );
  `);

  const customerCount = db.prepare('SELECT COUNT(*) as c FROM customers').get() as { c: number };
  if (customerCount.c === 0) {
    seedDb();
  }
}

export function seedDb() {
  const insertCustomer = db.prepare(`
    INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const customers = [
    ['c_1', 'Alice Smith', 'alice@example.com', 'Starter', 2500, 30, 'healthy'],
    ['c_2', 'Bob Jones', 'bob@example.com', 'Pro', 5000, 95, 'healthy'],
    ['c_3', 'Charlie Brown', 'charlie@example.com', 'Enterprise', 15000, 85, 'healthy'],
    ['c_4', 'Diana Prince', 'diana@example.com', 'Pro', 5000, 45, 'healthy'],
    ['c_5', 'Ethan Hunt', 'ethan@example.com', 'Starter', 2500, 15, 'healthy'],
    ['c_6', 'Fiona Gallagher', 'fiona@example.com', 'Pro', 5000, 92, 'healthy'],
    ['c_7', 'George Costanza', 'george@example.com', 'Starter', 2500, 5, 'healthy'],
    ['c_8', 'Hannah Abbott', 'hannah@example.com', 'Enterprise', 15000, 60, 'healthy']
  ];

  db.transaction(() => {
    // Clear all tables first to ensure a clean seed
    db.exec('DELETE FROM recoveries');
    db.exec('DELETE FROM agent_actions');
    db.exec('DELETE FROM offers');
    db.exec('DELETE FROM billing_events');
    db.exec('DELETE FROM customers');

    for (const c of customers) {
      insertCustomer.run(...c);
    }
  })();
}

export function resetDb() {
  if (db) {
    seedDb();
  } else {
    getDb();
  }
}

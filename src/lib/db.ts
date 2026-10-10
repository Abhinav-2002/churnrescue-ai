import Database from 'better-sqlite3';
import path from 'path';

declare global {
  var _sqliteDb: Database.Database | undefined;
  var _migrationsRun: boolean | undefined;
}

export function getDb() {
  if (!globalThis._sqliteDb) {
    // SQLITE_PATH lets scripts (try-agent, proof scripts) use an isolated DB.
    const dbPath =
      process.env.SQLITE_PATH ??
      (process.env.NODE_ENV === 'test' ? ':memory:' : path.join(process.cwd(), 'data.db'));

    globalThis._sqliteDb = new Database(dbPath);
    // Enforce foreign keys
    globalThis._sqliteDb.pragma('foreign_keys = ON');
    
    initDb();
  }
  if (!globalThis._migrationsRun) {
    migrateOffers(globalThis._sqliteDb);
    globalThis._migrationsRun = true;
  }
  return globalThis._sqliteDb;
}

function initDb() {
  const db = globalThis._sqliteDb!;
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
      paypal_order_id TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id) REFERENCES customers(id),
      FOREIGN KEY(billing_event_id) REFERENCES billing_events(id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('agent', 'customer')),
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_customer ON conversations(customer_id, created_at);
  `);

  migrateOffers(db);

  const customerCount = db.prepare('SELECT COUNT(*) as c FROM customers').get() as { c: number };
  if (customerCount.c === 0) {
    seedDb();
  }
}

export const MIGRATIONS = [
  { name: 'paypal_order_id', ddl: 'paypal_order_id TEXT NULL' },
  { name: 'paypal_order_status', ddl: "paypal_order_status TEXT NULL CHECK(paypal_order_status IS NULL OR paypal_order_status IN ('created', 'payer_action_required', 'approved', 'captured', 'declined', 'completed', 'failed'))" },
  { name: 'paypal_approve_url', ddl: 'paypal_approve_url TEXT NULL' },
  { name: 'discount_percent', ddl: 'discount_percent INTEGER NULL CHECK(discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 50))' },
  { name: 'target_plan', ddl: 'target_plan TEXT NULL' },
  { name: 'accepted_at', ddl: 'accepted_at TEXT NULL' },
  { name: 'capturing_at', ddl: 'capturing_at TEXT NULL' },
  { name: 'ladder_step', ddl: 'ladder_step INTEGER NOT NULL DEFAULT 0 CHECK(ladder_step BETWEEN 0 AND 2)' },
  // F-D4: claim timestamp for PayPal order creation. A separate column (not a new
  // paypal_order_status value) because ALTER TABLE cannot change CHECK constraints
  // on databases that already exist.
  { name: 'order_claimed_at', ddl: 'order_claimed_at TEXT NULL' }
];

export function migrateOffers(db: Database.Database) {
  const cols = new Set((db.prepare('PRAGMA table_info(offers)').all() as { name: string }[]).map((c) => c.name));
  for (const m of MIGRATIONS) {
    if (!cols.has(m.name)) db.exec(`ALTER TABLE offers ADD COLUMN ${m.ddl}`);
  }
}

export function seedDb() {
  const db = globalThis._sqliteDb!;
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
    db.exec('DELETE FROM conversations');
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
  if (globalThis._sqliteDb) {
    seedDb();
  } else {
    getDb();
  }
}

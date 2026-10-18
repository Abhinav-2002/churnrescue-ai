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
      is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0, 1)),
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
      is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0, 1)),
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
      is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0, 1)),
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
      is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0, 1)),
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
  { name: 'order_claimed_at', ddl: 'order_claimed_at TEXT NULL' },
  { name: 'is_sample', ddl: 'is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0, 1))' }
];

export const SAMPLE_TABLE_MIGRATIONS = ['billing_events', 'offers', 'agent_actions', 'recoveries'] as const;

export function migrateOffers(db: Database.Database) {
  const cols = new Set((db.prepare('PRAGMA table_info(offers)').all() as { name: string }[]).map((c) => c.name));
  for (const m of MIGRATIONS) {
    if (!cols.has(m.name)) db.exec(`ALTER TABLE offers ADD COLUMN ${m.ddl}`);
  }
  for (const tbl of SAMPLE_TABLE_MIGRATIONS) {
    const tblCols = new Set((db.prepare(`PRAGMA table_info(${tbl})`).all() as { name: string }[]).map((c) => c.name));
    if (tblCols.size > 0 && !tblCols.has('is_sample')) {
      db.exec(`ALTER TABLE ${tbl} ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0, 1))`);
    }
  }
}

export const SEED_CUSTOMERS: readonly [string, string, string, string, number, number, string][] = [
  ['c_1', 'Alice Smith', 'alice@example.com', 'Starter', 2500, 30, 'healthy'],
  ['c_2', 'Bob Jones', 'bob@example.com', 'Pro', 5000, 95, 'healthy'],
  ['c_3', 'Charlie Brown', 'charlie@example.com', 'Enterprise', 15000, 85, 'healthy'],
  ['c_4', 'Diana Prince', 'diana@example.com', 'Pro', 5000, 45, 'healthy'],
  ['c_5', 'Ethan Hunt', 'ethan@example.com', 'Starter', 2500, 15, 'healthy'],
  ['c_6', 'Fiona Gallagher', 'fiona@example.com', 'Pro', 5000, 92, 'healthy'],
  ['c_7', 'George Costanza', 'george@example.com', 'Starter', 2500, 5, 'healthy'],
  ['c_8', 'Hannah Abbott', 'hannah@example.com', 'Enterprise', 15000, 60, 'healthy']
];

export function seedDb() {
  const db = globalThis._sqliteDb!;
  const insertCustomer = db.prepare(`
    INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    // Clear all tables first to ensure a clean seed
    db.exec('DELETE FROM conversations');
    db.exec('DELETE FROM recoveries');
    db.exec('DELETE FROM agent_actions');
    db.exec('DELETE FROM offers');
    db.exec('DELETE FROM billing_events');
    db.exec('DELETE FROM customers');

    for (const c of SEED_CUSTOMERS) {
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

/**
 * Resets a single customer's live state (conversations, non-sample offers, billing events,
 * agent actions, recoveries) and restores their status to 'healthy', leaving all other
 * customers and any sample history rows untouched.
 * Returns false if the customer ID does not exist.
 */
export function resetCustomer(customerId: string): boolean {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM customers WHERE id = ?').get(customerId) as { id: string } | undefined;
  const seedTuple = SEED_CUSTOMERS.find((c) => c[0] === customerId);
  if (!existing && !seedTuple) {
    return false;
  }

  db.transaction(() => {
    db.prepare('DELETE FROM conversations WHERE customer_id = ?').run(customerId);
    db.prepare('DELETE FROM recoveries WHERE customer_id = ? AND is_sample = 0').run(customerId);
    db.prepare('DELETE FROM agent_actions WHERE customer_id = ? AND is_sample = 0').run(customerId);
    db.prepare('DELETE FROM offers WHERE customer_id = ? AND is_sample = 0').run(customerId);
    db.prepare('DELETE FROM billing_events WHERE customer_id = ? AND is_sample = 0').run(customerId);

    if (seedTuple) {
      const [id, name, email, planName, planPriceCents, usagePercent] = seedTuple;
      if (existing) {
        db.prepare(`
          UPDATE customers
          SET name = ?, email = ?, plan_name = ?, plan_price_cents = ?, usage_percent = ?, status = 'healthy'
          WHERE id = ?
        `).run(name, email, planName, planPriceCents, usagePercent, id);
      } else {
        db.prepare(`
          INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status)
          VALUES (?, ?, ?, ?, ?, ?, 'healthy')
        `).run(id, name, email, planName, planPriceCents, usagePercent);
      }
    } else {
      db.prepare(`UPDATE customers SET status = 'healthy' WHERE id = ?`).run(customerId);
    }
  })();

  return true;
}

export function clearSampleHistory(): { deleted: number } {
  const db = getDb();
  let deleted = 0;
  db.transaction(() => {
    deleted += db.prepare('DELETE FROM recoveries WHERE is_sample = 1').run().changes;
    deleted += db.prepare('DELETE FROM agent_actions WHERE is_sample = 1').run().changes;
    deleted += db.prepare('DELETE FROM offers WHERE is_sample = 1').run().changes;
    deleted += db.prepare('DELETE FROM billing_events WHERE is_sample = 1').run().changes;
  })();
  return { deleted };
}

/**
 * Idempotently loads ~14 days of synthetic history flagged is_sample = 1.
 * Never creates real PayPal orders, never enters capture logic, and never alters customers.status.
 */
export function loadSampleHistory(): { loaded: number } {
  const db = getDb();
  const nowMs = Date.now();
  const dayMs = 86_400_000;

  // Ensure seed customers exist without overwriting their live status
  const insertMissingCustomer = db.prepare(`
    INSERT OR IGNORE INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const sampleSpecs = [
    // Current 14d window (daysAgo 1..13)
    { suffix: 's01', customerId: 'c_1', daysAgo: 1, price: 2500, kind: 'partial_credit', discount: 20, step: 0, amount: 2000, recovered: true, action: 'partial_credit', clamps: ['propose intent < 60 usage -> partial_credit'] },
    { suffix: 's02', customerId: 'c_3', daysAgo: 2, price: 15000, kind: 'retry', discount: null, step: 0, amount: 15000, recovered: true, action: 'retry', clamps: ['propose intent >= 60 usage -> retry'] },
    { suffix: 's03', customerId: 'c_4', daysAgo: 3, price: 5000, kind: 'partial_credit', discount: 35, step: 1, amount: 3250, recovered: true, action: 'partial_credit', clamps: ['negotiate intent < 60 usage -> partial_credit'] },
    { suffix: 's04', customerId: 'c_5', daysAgo: 5, price: 2500, kind: 'partial_credit', discount: 20, step: 0, amount: 2000, recovered: true, action: 'partial_credit', clamps: ['propose intent < 60 usage -> partial_credit'] },
    { suffix: 's05', customerId: 'c_6', daysAgo: 6, price: 5000, kind: 'retry', discount: null, step: 0, amount: 5000, recovered: false, action: 'escalate', clamps: ['forced escalate by keyword rule: dispute'], reason: 'dispute', severity: 'High' },
    { suffix: 's06', customerId: 'c_8', daysAgo: 8, price: 15000, kind: 'retry', discount: null, step: 0, amount: 15000, recovered: true, action: 'retry', clamps: ['propose intent >= 60 usage -> retry'] },
    { suffix: 's07', customerId: 'c_2', daysAgo: 10, price: 5000, kind: 'retry', discount: null, step: 0, amount: 5000, recovered: true, action: 'retry', clamps: ['propose intent >= 60 usage -> retry'] },
    { suffix: 's08', customerId: 'c_7', daysAgo: 12, price: 2500, kind: 'partial_credit', discount: 20, step: 0, amount: 2000, recovered: true, action: 'partial_credit', clamps: ['propose intent < 60 usage -> partial_credit'] },
    // Previous 14d window (daysAgo 15..25, >= 3 failed events so deltas populate when viewing 14d sample mode)
    { suffix: 's09', customerId: 'c_1', daysAgo: 16, price: 2500, kind: 'partial_credit', discount: 20, step: 0, amount: 2000, recovered: true, action: 'partial_credit', clamps: ['propose intent < 60 usage -> partial_credit'] },
    { suffix: 's10', customerId: 'c_3', daysAgo: 18, price: 15000, kind: 'retry', discount: null, step: 0, amount: 15000, recovered: true, action: 'retry', clamps: ['propose intent >= 60 usage -> retry'] },
    { suffix: 's11', customerId: 'c_4', daysAgo: 20, price: 5000, kind: 'partial_credit', discount: 20, step: 0, amount: 4000, recovered: false, action: 'partial_credit', clamps: ['propose intent < 60 usage -> partial_credit'] },
    { suffix: 's12', customerId: 'c_8', daysAgo: 23, price: 15000, kind: 'retry', discount: null, step: 0, amount: 15000, recovered: false, action: 'retry', clamps: ['propose intent >= 60 usage -> retry'] },
  ];

  db.transaction(() => {
    for (const c of SEED_CUSTOMERS) {
      insertMissingCustomer.run(...c);
    }

    db.prepare('DELETE FROM recoveries WHERE is_sample = 1').run();
    db.prepare('DELETE FROM agent_actions WHERE is_sample = 1').run();
    db.prepare('DELETE FROM offers WHERE is_sample = 1').run();
    db.prepare('DELETE FROM billing_events WHERE is_sample = 1').run();

    for (const s of sampleSpecs) {
      const eventDate = new Date(nowMs - s.daysAgo * dayMs).toISOString();
      const recDate = new Date(nowMs - s.daysAgo * dayMs + 2 * 3600_000).toISOString();
      const beId = `be_sample_${s.suffix}`;
      const offId = `off_sample_${s.suffix}`;
      const actId = `act_sample_${s.suffix}`;
      const recId = `rec_sample_${s.suffix}`;

      db.prepare(`
        INSERT INTO billing_events (id, customer_id, type, amount_cents, status, paypal_order_id, paypal_error_code, idempotency_key, is_sample, created_at)
        VALUES (?, ?, 'renewal', ?, ?, NULL, 'INSTRUMENT_DECLINED', ?, 1, ?)
      `).run(beId, s.customerId, s.price, s.recovered ? 'recovered' : 'failed', `sample_idem_${s.suffix}`, eventDate);

      db.prepare(`
        INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, discount_percent, ladder_step, status, is_sample, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        offId,
        s.customerId,
        beId,
        s.kind,
        s.amount,
        s.discount,
        s.step,
        s.recovered ? 'captured' : (s.action === 'escalate' ? 'superseded' : 'pending'),
        eventDate
      );

      db.prepare(`
        INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json, is_sample, created_at)
        VALUES (?, ?, ?, ?, 'Synthetic sample history', ?, 1, ?)
      `).run(
        actId,
        s.customerId,
        beId,
        s.action,
        JSON.stringify({
          proposed_discount_percent: null,
          approved_discount_percent: s.discount,
          clamps: s.clamps,
          template_used: s.action === 'escalate',
          ladder_step: s.step,
          reason_category: (s as any).reason ?? null,
          severity: (s as any).severity ?? null
        }),
        eventDate
      );

      if (s.recovered) {
        db.prepare(`
          INSERT INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id, is_sample, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        `).run(recId, s.customerId, beId, s.price, s.amount, `sample_ord_${s.suffix}`, recDate);
      }
    }
  })();

  return { loaded: sampleSpecs.length };
}

export function closeDb(): void {
  if (globalThis._sqliteDb) {
    try {
      globalThis._sqliteDb.close();
    } catch {
      // ignore if already closed
    }
    globalThis._sqliteDb = undefined;
  }
}

declare global {
  var _sigtermRegistered: boolean | undefined;
}

if (typeof process !== 'undefined' && typeof process.once === 'function' && !globalThis._sigtermRegistered) {
  globalThis._sigtermRegistered = true;
  process.once('SIGTERM', () => {
    closeDb();
  });
}


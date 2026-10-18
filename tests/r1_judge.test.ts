import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { getDb, resetDb, migrateOffers } from '../src/lib/db';
import { POST as resetGlobalPOST } from '../src/app/api/reset/route';
import { POST as resetCustomerPOST } from '../src/app/api/demo/reset-customer/route';
import { POST as samplePOST } from '../src/app/api/demo/sample/route';
import { GET as metricsGET } from '../src/app/api/dashboard/metrics/route';
import { POST as capturePOST } from '../src/app/api/offers/[offerId]/capture/route';
import { POST as confirmPausePOST } from '../src/app/api/agent/confirm-pause/route';
import { POST as startPOST } from '../src/app/api/agent/start/route';
import { POST as messagePOST } from '../src/app/api/agent/message/route';
import { GET as stateGET } from '../src/app/api/agent/state/route';
import { createOrderInternal, create_recovery_order } from '../src/lib/agent/tools';
import { AIMessage } from '@langchain/core/messages';

vi.mock('../src/lib/agent/llm', () => ({
  getLlm: () => ({
    withStructuredOutput() {
      return {
        invoke: async () => ({
          intent: 'neutral',
          proposal: { reasoning: 'mock reasoning', message_tone_notes: 'empathetic' }
        })
      };
    },
    async invoke() {
      return new AIMessage('Fallback triggers template with exact numbers.');
    }
  })
}));

describe('Stage R1 (r1-judge): Reset Isolation, Sample History, Migration, and Concurrency', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv, NODE_ENV: 'test', DEMO_MODE: '1' };
    delete process.env.HOSTED_DEMO;
    delete process.env.ALLOW_GLOBAL_RESET;
    resetDb();
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('1. Blocks global POST /api/reset with 403 hosted_reset_disabled when HOSTED_DEMO=1 unless ALLOW_GLOBAL_RESET=1', async () => {
    process.env.HOSTED_DEMO = '1';
    const resBlocked = await resetGlobalPOST(new Request('http://localhost:3000/api/reset', { method: 'POST' }));
    expect(resBlocked.status).toBe(403);
    const bodyBlocked = await resBlocked.json();
    expect(bodyBlocked.error).toBe('hosted_reset_disabled');

    process.env.ALLOW_GLOBAL_RESET = '1';
    const resAllowed = await resetGlobalPOST(new Request('http://localhost:3000/api/reset', { method: 'POST' }));
    expect(resAllowed.status).toBe(200);
    const bodyAllowed = await resAllowed.json();
    expect(bodyAllowed.success).toBe(true);
  });

  it('2. POST /api/demo/reset-customer enforces DEMO_MODE, returns 404 for unknown ID, and resets only target customer', async () => {
    const db = getDb();

    // Put both c_1 and c_2 into active recovery states
    db.prepare("UPDATE customers SET status = 'at_risk' WHERE id IN ('c_1', 'c_2')").run();
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status, paypal_order_id) VALUES ('be_c1', 'c_1', 'renewal', 2500, 'failed', 'ord_c1')").run();
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status, paypal_order_id) VALUES ('be_c2', 'c_2', 'renewal', 5000, 'failed', 'ord_c2')").run();
    db.prepare("INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, discount_percent, ladder_step, status) VALUES ('off_c1', 'c_1', 'be_c1', 'partial_credit', 2000, 20, 0, 'pending')").run();
    db.prepare("INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, discount_percent, ladder_step, status) VALUES ('off_c2', 'c_2', 'be_c2', 'retry', 5000, 0, 0, 'pending')").run();
    db.prepare("INSERT INTO conversations (id, customer_id, role, text, created_at) VALUES ('msg_c1', 'c_1', 'agent', 'Hello c_1', CURRENT_TIMESTAMP), ('msg_c2', 'c_2', 'agent', 'Hello c_2', CURRENT_TIMESTAMP)").run();

    // When DEMO_MODE=0 -> 404
    process.env.DEMO_MODE = '0';
    const resDisabled = await resetCustomerPOST(
      new Request('http://localhost:3000/api/demo/reset-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: 'c_1' })
      })
    );
    expect(resDisabled.status).toBe(404);
    process.env.DEMO_MODE = '1';

    // Unknown customer -> 404
    const resUnknown = await resetCustomerPOST(
      new Request('http://localhost:3000/api/demo/reset-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: 'c_nonexistent' })
      })
    );
    expect(resUnknown.status).toBe(404);

    // Reset c_1 only
    const resResetC1 = await resetCustomerPOST(
      new Request('http://localhost:3000/api/demo/reset-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: 'c_1' })
      })
    );
    expect(resResetC1.status).toBe(200);
    const jsonC1 = await resResetC1.json();
    expect(jsonC1.success).toBe(true);
    expect(jsonC1.customerId).toBe('c_1');

    // Verify c_1 is clean while c_2 is completely untouched
    const c1Row = db.prepare("SELECT status FROM customers WHERE id = 'c_1'").get() as { status: string };
    const c2Row = db.prepare("SELECT status FROM customers WHERE id = 'c_2'").get() as { status: string };
    expect(c1Row.status).toBe('healthy');
    expect(c2Row.status).toBe('at_risk');

    const c1Offers = db.prepare("SELECT * FROM offers WHERE customer_id = 'c_1'").all();
    const c2Offers = db.prepare("SELECT * FROM offers WHERE customer_id = 'c_2'").all();
    expect(c1Offers.length).toBe(0);
    expect(c2Offers.length).toBe(1);

    const c1Msgs = db.prepare("SELECT * FROM conversations WHERE customer_id = 'c_1'").all();
    const c2Msgs = db.prepare("SELECT * FROM conversations WHERE customer_id = 'c_2'").all();
    expect(c1Msgs.length).toBe(0);
    expect(c2Msgs.length).toBe(1);
  });

  it('3. Migrates a legacy SQLite database without is_sample columns cleanly via migrateOffers', () => {
    const legacyDb = new Database(':memory:');
    legacyDb.exec(`
      CREATE TABLE billing_events (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, type TEXT NOT NULL, amount_cents INTEGER NOT NULL, status TEXT NOT NULL);
      CREATE TABLE offers (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, billing_event_id TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE agent_actions (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, billing_event_id TEXT NOT NULL, action TEXT NOT NULL);
      CREATE TABLE recoveries (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, billing_event_id TEXT NOT NULL, original_amount_cents INTEGER NOT NULL, recovered_amount_cents INTEGER NOT NULL, paypal_order_id TEXT NOT NULL);
      INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_old', 'c_1', 'renewal', 2500, 'failed');
    `);

    migrateOffers(legacyDb);

    const row = legacyDb.prepare("SELECT id, is_sample FROM billing_events WHERE id = 'be_old'").get() as { id: string; is_sample: number };
    expect(row.is_sample).toBe(0);

    // Calling migrateOffers a second time is idempotent
    migrateOffers(legacyDb);
    legacyDb.close();
  });

  it('4. Sample history (is_sample=1) separates live vs sample metrics and cannot create PayPal orders, capture payments, or change customer status', async () => {
    const db = getDb();

    // Load sample history via API
    const sampleRes = await samplePOST(
      new Request('http://localhost:3000/api/demo/sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'load' })
      })
    );
    expect(sampleRes.status).toBe(200);
    const sampleJson = await sampleRes.json();
    expect(sampleJson.loaded).toBe(12);

    // Verify all customers remain 'healthy' (sample history never changes customer status)
    const nonHealthy = db.prepare("SELECT COUNT(*) as c FROM customers WHERE status != 'healthy'").get() as { c: number };
    expect(nonHealthy.c).toBe(0);

    // Default metrics (include_sample=0) excludes sample rows
    const liveMetricsRes = await metricsGET(new Request('http://localhost:3000/api/dashboard/metrics?days=14'));
    expect(liveMetricsRes.status).toBe(200);
    const liveMetrics = await liveMetricsRes.json();
    expect(liveMetrics.kpis.includes_sample).toBe(false);
    expect(liveMetrics.kpis.total_failed).toBe(0);
    expect(liveMetrics.kpis.total_recovered).toBe(0);
    expect(liveMetrics.kpis.sample_failed_events).toBe(12);

    // Sample-enabled metrics (include_sample=1) includes sample rows and computes period deltas
    const incMetricsRes = await metricsGET(new Request('http://localhost:3000/api/dashboard/metrics?days=14&include_sample=1'));
    expect(incMetricsRes.status).toBe(200);
    const incMetrics = await incMetricsRes.json();
    expect(incMetrics.kpis.includes_sample).toBe(true);
    expect(incMetrics.kpis.total_failed).toBeGreaterThan(0);
    expect(incMetrics.kpis.total_recovered).toBeGreaterThan(0);
    expect(incMetrics.range_totals.deltas.recovered_revenue_percent).not.toBeNull();

    // Verify a sample offer cannot create a PayPal order via createOrderInternal or create_recovery_order
    const internalOrder = await createOrderInternal('off_sample_s01');
    expect(internalOrder).toBeNull();

    const toolRes = await create_recovery_order.invoke(
      { offerId: 'off_sample_s01' },
      { configurable: { customerId: 'c_1' } }
    );
    expect(JSON.parse(toolRes as string).error).toBe('Sample offer cannot create PayPal order');

    // Verify a sample offer cannot be captured via POST /api/offers/[offerId]/capture
    const capRes = await capturePOST(
      new Request('http://localhost:3000/api/offers/off_sample_s01/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: 'ORD_FAKE_123' })
      }),
      { params: Promise.resolve({ offerId: 'off_sample_s01' }) }
    );
    expect(capRes.status).toBe(400);
    const capBody = await capRes.json();
    expect(capBody.error).toBe('sample_offer_not_capturable');

    // Verify a sample pause offer cannot be confirmed via POST /api/agent/confirm-pause
    const pauseRes = await confirmPausePOST(
      new Request('http://localhost:3000/api/agent/confirm-pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: 'c_3' })
      })
    );
    expect(pauseRes.status).toBe(404);
  });

  it('5. Concurrent visitor isolation & multi-tab consistency: c_1 and c_2 run concurrently, resetting c_1 mid-flight preserves c_2, and two tabs on c_1 share consistent state', async () => {
    const db = getDb();
    db.prepare("UPDATE customers SET status = 'at_risk' WHERE id IN ('c_1', 'c_2')").run();
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status, paypal_order_id) VALUES ('be_c1', 'c_1', 'renewal', 2500, 'failed', 'ord_c1')").run();
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status, paypal_order_id) VALUES ('be_c2', 'c_2', 'renewal', 5000, 'failed', 'ord_c2')").run();

    // Start c_1 (Tab A & Tab B simultaneously) and c_2 concurrently
    const [startC1A, startC1B, startC2] = await Promise.all([
      startPOST(new Request('http://localhost:3000/api/agent/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: 'c_1' })
      })),
      stateGET(new Request('http://localhost:3000/api/agent/state?customerId=c_1')),
      startPOST(new Request('http://localhost:3000/api/agent/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: 'c_2' })
      }))
    ]);

    expect(startC1A.status).toBe(200);
    expect(startC1B.status).toBe(200);
    expect(startC2.status).toBe(200);

    // Calling startPOST again in second tab for c_1 returns existing greeting without duplicating offers
    const startC1SecondTab = await startPOST(new Request('http://localhost:3000/api/agent/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: 'c_1' })
    }));
    const c1SecondData = await startC1SecondTab.json();
    expect(typeof c1SecondData.reply).toBe('string');
    const c1OpenOffers = db.prepare("SELECT * FROM offers WHERE customer_id = 'c_1' AND status IN ('pending', 'accepted') AND is_sample = 0").all();
    expect(c1OpenOffers.length).toBe(1);

    // Reset c_1 while c_2 sends a message
    const [resetC1Res, msgC2Res] = await Promise.all([
      resetCustomerPOST(new Request('http://localhost:3000/api/demo/reset-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: 'c_1' })
      })),
      messagePOST(new Request('http://localhost:3000/api/agent/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: 'c_2', text: 'this is a chargeback' })
      }))
    ]);

    expect(resetC1Res.status).toBe(200);
    expect(msgC2Res.status).toBe(200);
    const msgC2Json = await msgC2Res.json();
    expect(msgC2Json.nextStep).toBe('escalated');

    // c_1 is healthy and clean; c_2 is escalated in human queue
    const c1After = db.prepare("SELECT status FROM customers WHERE id = 'c_1'").get() as { status: string };
    const c2Actions = db.prepare("SELECT action FROM agent_actions WHERE customer_id = 'c_2' ORDER BY created_at DESC, rowid DESC LIMIT 1").get() as { action: string };
    expect(c1After.status).toBe('healthy');
    expect(c2Actions.action).toBe('escalate');
  });

  it('6. Deterministic Concession Ladder metric: counts code-assigned ladder discounts without requiring model proposed_discount_percent', async () => {
    const db = getDb();
    db.prepare("UPDATE customers SET status = 'at_risk' WHERE id = 'c_1'").run();
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status, paypal_order_id) VALUES ('be_c1_ladder', 'c_1', 'renewal', 2500, 'failed', 'ord_c1_ladder')").run();

    const startRes = await startPOST(
      new Request('http://localhost:3000/api/agent/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: 'c_1' })
      })
    );
    expect(startRes.status).toBe(200);

    const metricsRes = await metricsGET(new Request('http://localhost:3000/api/dashboard/metrics?days=14'));
    expect(metricsRes.status).toBe(200);
    const metricsJson = await metricsRes.json();

    expect(metricsJson.guardrail_summary.pricing_adjustments).toBe(1);
    expect(metricsJson.guardrail_summary.latest_clamp_summary).toBe('Code ladder assigned 20% discount (step 0)');
  });
});

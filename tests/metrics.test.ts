import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb } from '../src/lib/db';
import { GET } from '../src/app/api/dashboard/metrics/route';

describe('Metrics Endpoint', () => {
  beforeEach(() => {
    const db = getDb();
    db.exec('DELETE FROM agent_actions; DELETE FROM conversations; DELETE FROM recoveries; DELETE FROM offers; DELETE FROM billing_events; DELETE FROM customers;');
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function mockRequest(headers: Record<string, string> = {}) {
    const reqHeaders = new Headers();
    for (const [k, v] of Object.entries(headers)) {
      reqHeaders.set(k, v);
    }
    // Set mock IP for rate limiter
    reqHeaders.set('x-forwarded-for', '127.0.0.1');
    return {
      headers: reqHeaders,
    } as unknown as Request;
  }

  it('failed 5000 / recovered 4000 gives 80%', async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_1', 'C1', 'c1@test', 'Pro', 5000, 10, 'healthy')").run();
    for (let i = 0; i < 10; i++) {
      db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, 'c_1', 'renewal', 5000, 'failed')").run(`b_\${i}`);
      if (i < 8) {
        db.prepare("INSERT INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id) VALUES (?, 'c_1', ?, 5000, 4000, ?)").run(`r_\${i}`, `b_\${i}`, `p_\${i}`);
      }
    }

    const res = await GET(await mockRequest());
    const json = await (res as Response).json();
    expect(json.kpis.total_failed).toBe(10);
    expect(json.kpis.total_recovered).toBe(8);
    expect(json.kpis.recovery_rate).toBe(0.8);
    
    // Check daily series UTC mapping too
    expect(json.daily_series.length).toBeGreaterThan(0);
    expect(json.daily_series[0].failed_amount_cents).toBe(50000); // 10 * 5000
    expect(json.daily_series[0].recovered_amount_cents).toBe(32000); // 8 * 4000
  });

  it('zero failures gives rate 0', async () => {
    const res = await GET(await mockRequest());
    const json = await (res as Response).json();
    expect(json.kpis.total_failed).toBe(0);
    expect(json.kpis.recovery_rate).toBe(0);
  });

  it('escalated and paused counts', async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_1', 'C1', 'c@t', 'Pro', 5000, 10, 'paused')").run();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_2', 'C2', 'c@t', 'Pro', 5000, 10, 'at_risk')").run();
    
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_2', 'c_2', 'renewal', 5000, 'failed')").run();
    db.prepare("INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json) VALUES ('a_1', 'c_2', 'be_2', 'escalate', 'test', '{}')").run();

    const res = await GET(await mockRequest());
    const json = await (res as Response).json();
    expect(json.kpis.paused).toBe(1);
    expect(json.kpis.escalated).toBe(1);
  });

  it('superseded excluded', async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_1', 'C1', 'c@t', 'Pro', 5000, 10, 'at_risk')").run();
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 5000, 'failed')").run();
    
    db.prepare("INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, discount_percent, status, ladder_step) VALUES ('o_1', 'c_1', 'be_1', 'partial_credit', 4000, 20, 'superseded', 0)").run();
    db.prepare("INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, discount_percent, status, ladder_step) VALUES ('o_2', 'c_1', 'be_1', 'partial_credit', 2500, 50, 'accepted', 1)").run();

    const res = await GET(await mockRequest());
    const json = await (res as Response).json();
    
    expect(json.funnel.offered).toBe(1); // o_2
    expect(json.funnel.accepted).toBe(1); // o_2
    expect(json.kpis.average_discount).toBe(50); // superseded 20% excluded
  });

  it('funnel', async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_1', 'C1', 'c@t', 'Pro', 5000, 10, 'at_risk')").run();
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 5000, 'failed')").run();
    db.prepare("INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, discount_percent, status, ladder_step) VALUES ('o_1', 'c_1', 'be_1', 'partial_credit', 2500, 50, 'accepted', 1)").run();
    db.prepare("INSERT INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id) VALUES ('r_1', 'c_1', 'be_1', 5000, 2500, 'p_1')").run();
    
    const res = await GET(await mockRequest());
    const json = await (res as Response).json();
    
    expect(json.funnel.failed).toBe(1);
    expect(json.funnel.offered).toBe(1);
    expect(json.funnel.accepted).toBe(1);
    expect(json.funnel.paid).toBe(1);
  });

  it('guardrail categories from stored clamps', async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_1', 'C1', 'c@t', 'Pro', 5000, 10, 'at_risk')").run();
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 5000, 'failed')").run();
    db.prepare("INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json) VALUES ('a_1', 'c_1', 'be_1', 'escalate', 'test', '{\"clamps\":[\"forced escalate by keyword rule: test\"]}')").run();

    const res = await GET(await mockRequest());
    const json = await (res as Response).json();
    
    expect(json.decisions[0].guardrail_category).toBe('escalated_by_keyword');
  });

  it('the proposed-vs-approved discount appears for a clamped decision', async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_1', 'C1', 'c@t', 'Pro', 5000, 10, 'at_risk')").run();
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 5000, 'failed')").run();
    db.prepare("INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json) VALUES ('a_1', 'c_1', 'be_1', 'partial_credit', 'test', '{\"proposed_discount_percent\": 80, \"approved_discount_percent\": 50, \"ladder_step\": 2}')").run();

    const res = await GET(await mockRequest());
    const json = await (res as Response).json();
    
    const d = json.decisions[0];
    expect(d.proposed_discount_percent).toBe(80);
    expect(d.approved_discount_percent).toBe(50);
    expect(d.ladder_step).toBe(2);
    expect(d.guardrail_category).toBe('ladder_limited'); // automatically determined by the > check
  });

  it('median hours', async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_1', 'C1', 'c@t', 'Pro', 5000, 10, 'at_risk')").run();
    
    // Day 1
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status, created_at) VALUES ('be_1', 'c_1', 'renewal', 5000, 'failed', '2026-01-01 10:00:00')").run();
    db.prepare("INSERT INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id, created_at) VALUES ('r_1', 'c_1', 'be_1', 5000, 2500, 'p_1', '2026-01-01 12:00:00')").run(); // 2 hours
    
    // Day 2
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status, created_at) VALUES ('be_2', 'c_1', 'renewal', 5000, 'failed', '2026-01-02 10:00:00')").run();
    db.prepare("INSERT INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id, created_at) VALUES ('r_2', 'c_1', 'be_2', 5000, 2500, 'p_2', '2026-01-02 15:00:00')").run(); // 5 hours

    // Day 3
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status, created_at) VALUES ('be_3', 'c_1', 'renewal', 5000, 'failed', '2026-01-03 10:00:00')").run();
    db.prepare("INSERT INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id, created_at) VALUES ('r_3', 'c_1', 'be_3', 5000, 2500, 'p_3', '2026-01-03 20:00:00')").run(); // 10 hours

    const res = await GET(await mockRequest());
    const json = await (res as Response).json();
    
    // 2, 5, 10 -> median is 5
    expect(json.kpis.median_hours_to_recovery).toBeCloseTo(5);
  });

  it('ETag returns 304 when unchanged and 200 when data changes', async () => {
    const req1 = await mockRequest();
    const res1 = await GET(req1) as Response;
    expect(res1.status).toBe(200);
    const etag = res1.headers.get('ETag');
    expect(etag).toBeTruthy();

    const req2 = await mockRequest({ 'if-none-match': etag! });
    const res2 = await GET(req2) as Response;
    expect(res2.status).toBe(304);

    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_1', 'C1', 'c@t', 'Pro', 5000, 10, 'at_risk')").run();
    
    const req3 = await mockRequest({ 'if-none-match': etag! });
    const res3 = await GET(req3) as Response;
    expect(res3.status).toBe(200); // data changed, e-tag mismatch
  });

  it('response contains no email, order id or free text', async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_1', 'C1', 'c1@test.com', 'Pro', 5000, 10, 'at_risk')").run();
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 5000, 'failed')").run();
    db.prepare("INSERT INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id) VALUES ('r_1', 'c_1', 'be_1', 5000, 2500, 'secret_paypal_id_abc')").run();
    db.prepare("INSERT INTO conversations (id, customer_id, role, text, created_at) VALUES ('msg_1', 'c_1', 'agent', 'Free text explanation', '2026-01-01')").run();
    db.prepare("INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json) VALUES ('a_1', 'c_1', 'be_1', 'partial_credit', 'reasoning text', '{}')").run();

    const res = await GET(await mockRequest());
    const json = await (res as Response).json();
    
    const textStr = JSON.stringify(json);
    expect(textStr).not.toContain('c1@test.com');
    expect(textStr).not.toContain('secret_paypal_id_abc');
    expect(textStr).not.toContain('Free text explanation');
    expect(textStr).not.toContain('reasoning text');

    // assert explicitly
    expect((json.customers[0] as any).email).toBeUndefined();
    expect((json.recoveries[0] as any).paypal_order_id).toBeUndefined();
    expect((json.decisions[0] as any).reasoning).toBeUndefined();
  });

  it('rate limit 429', async () => {
    const limit = 300; // LIMITS.dashboardMetrics.globalPerWindow
    for (let i = 0; i < limit; i++) {
      const r = await GET(await mockRequest()) as Response;
      if (r.status === 429) {
        throw new Error('Hit limit too early');
      }
    }
    const res = await GET(await mockRequest()) as Response;
    expect(res.status).toBe(429);
  });

  it('an exception returns only a short code', async () => {
    const db = getDb();
    vi.spyOn(db, 'prepare').mockImplementation(() => {
      throw new Error('Secret DB error details');
    });

    const res = await GET(await mockRequest()) as Response;
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('internal_error');
    expect(JSON.stringify(json)).not.toContain('Secret');
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb } from '../src/lib/db';
import { GET, auditOffer, classifyEscalationReason } from '../src/app/api/dashboard/metrics/route';
import { resetRateLimitsForTests } from '../src/lib/rate-limit';

describe('Metrics Endpoint v2', () => {
  beforeEach(() => {
    const db = getDb();
    db.exec('DELETE FROM agent_actions; DELETE FROM conversations; DELETE FROM recoveries; DELETE FROM offers; DELETE FROM billing_events; DELETE FROM customers;');
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
    resetRateLimitsForTests();
  });

  async function mockRequest(
    urlOrHeaders?: string | Record<string, string>,
    maybeHeaders?: Record<string, string>,
    ip = '127.0.0.1'
  ) {
    let url = 'http://localhost:3000/api/dashboard/metrics';
    let headers: Record<string, string> = {};

    if (typeof urlOrHeaders === 'string') {
      url = urlOrHeaders;
      if (maybeHeaders) headers = maybeHeaders;
    } else if (urlOrHeaders) {
      headers = urlOrHeaders;
    }

    const reqHeaders = new Headers();
    for (const [k, v] of Object.entries(headers)) {
      reqHeaders.set(k, v);
    }
    reqHeaders.set('x-forwarded-for', ip);

    return new Request(url, {
      headers: reqHeaders,
    });
  }

  // --- Baseline Stage 6.1 Tests Maintained ---

  it('failed 5000 / recovered 4000 gives 80%', async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_1', 'C1', 'c1@test', 'Pro', 5000, 10, 'healthy')").run();
    for (let i = 0; i < 10; i++) {
      db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, 'c_1', 'renewal', 5000, 'failed')").run(`b_${i}`);
      if (i < 8) {
        db.prepare("INSERT INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id) VALUES (?, 'c_1', ?, 5000, 4000, ?)").run(`r_${i}`, `b_${i}`, `p_${i}`);
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

  // --- Checkpoint B: 20 Named Comprehensive Tests ---

  it('1. every metric against a seeded fixture with known expected answers', async () => {
    const db = getDb();
    // Seed 2 customers
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_1', 'Alice', 'alice@test.com', 'Pro', 5000, 30, 'recovered')").run();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_2', 'Bob', 'bob@test.com', 'Starter', 2500, 80, 'at_risk')").run();

    // 2 failed events
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 5000, 'failed')").run();
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_2', 'c_2', 'renewal', 2500, 'failed')").run();

    // 1 accepted offer (c_1, 20% discount = 4000)
    db.prepare("INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, discount_percent, ladder_step, status) VALUES ('off_1', 'c_1', 'be_1', 'partial_credit', 4000, 20, 0, 'accepted')").run();

    // 1 recovery (c_1 recovered 4000)
    db.prepare("INSERT INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id) VALUES ('rec_1', 'c_1', 'be_1', 5000, 4000, 'p_1')").run();

    // 2 decisions (c_1 partial_credit, c_2 escalate)
    db.prepare("INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json) VALUES ('act_1', 'c_1', 'be_1', 'partial_credit', 'reason 1', '{\"proposed_discount_percent\":50,\"approved_discount_percent\":20,\"ladder_step\":0}')").run();
    db.prepare("INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json) VALUES ('act_2', 'c_2', 'be_2', 'escalate', 'reason 2', '{\"clamps\":[\"forced escalate by keyword rule: dispute\"]}')").run();

    const res = await GET(await mockRequest('http://localhost:3000/api/dashboard/metrics?days=14'));
    expect(res.status).toBe(200);
    const json = await res.json();

    // In-period range totals
    expect(json.range_totals.current.recovered_revenue_cents).toBe(4000);
    expect(json.range_totals.current.failed_amount_cents).toBe(7500);
    expect(json.range_totals.current.customers_recovered).toBe(1);
    expect(json.range_totals.current.needs_human).toBe(1);
    expect(json.range_totals.current.recovery_rate).toBeCloseTo(4000 / 7500);

    // Intervention mix
    expect(json.intervention_mix.total_interventions).toBe(2);
    expect(json.intervention_mix.credit).toBe(1);
    expect(json.intervention_mix.escalate).toBe(1);
    expect(json.intervention_mix.retry).toBe(0);

    // Guardrail summary
    expect(json.guardrail_summary.pricing_adjustments).toBe(1);
    expect(json.guardrail_summary.escalated_by_keyword).toBe(1);
    expect(json.guardrail_summary.latest_clamp_summary).toBe('Model proposed 50%, code allowed 20%');

    // Policy audit
    expect(json.policy_audit.total_audited).toBe(1);
    expect(json.policy_audit.outside_policy_count).toBe(0);
    expect(json.policy_audit.violating_offer_ids).toEqual([]);

    // Human queue
    expect(json.human_queue.length).toBe(1);
    expect(json.human_queue[0].name).toBe('Bob');
    expect(json.human_queue[0].reason_category).toBe('dispute');
    expect(json.human_queue[0].severity).toBe('High');
  });

  it('2. recovered <= failed invariant holds across all periods and data points', async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_1', 'Alice', 'a@t', 'Pro', 5000, 10, 'recovered')").run();
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 5000, 'failed')").run();
    db.prepare("INSERT INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id) VALUES ('rec_1', 'c_1', 'be_1', 5000, 4000, 'p_1')").run();

    const res = await GET(await mockRequest());
    const json = await res.json();

    expect(json.range_totals.current.recovered_revenue_cents).toBeLessThanOrEqual(json.range_totals.current.failed_amount_cents);
    expect(json.kpis.total_recovered).toBeLessThanOrEqual(json.kpis.total_failed);
    expect(json.kpis.recovery_rate).toBeLessThanOrEqual(1.0);
  });

  it('3. funnel is monotonic: failed >= offered >= accepted >= paid', async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_1', 'Alice', 'a@t', 'Pro', 5000, 10, 'recovered')").run();
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 5000, 'failed')").run();
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_2', 'c_1', 'renewal', 5000, 'failed')").run();
    db.prepare("INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status) VALUES ('off_1', 'c_1', 'be_1', 'retry', 5000, 'accepted')").run();
    db.prepare("INSERT INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id) VALUES ('rec_1', 'c_1', 'be_1', 5000, 5000, 'p_1')").run();

    const res = await GET(await mockRequest());
    const json = await res.json();

    expect(json.funnel.failed).toBeGreaterThanOrEqual(json.funnel.offered);
    expect(json.funnel.offered).toBeGreaterThanOrEqual(json.funnel.accepted);
    expect(json.funnel.accepted).toBeGreaterThanOrEqual(json.funnel.paid);
  });

  it('4. delta is null/suppressed when previous period has fewer than 3 failed events', async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_1', 'Alice', 'a@t', 'Pro', 5000, 10, 'healthy')").run();
    
    // Only 2 failures in previous period (needs >= 3)
    const prevDate = new Date(Date.now() - 20 * 86400 * 1000).toISOString();
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status, created_at) VALUES ('be_old_1', 'c_1', 'renewal', 5000, 'failed', ?)").run(prevDate);
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status, created_at) VALUES ('be_old_2', 'c_1', 'renewal', 5000, 'failed', ?)").run(prevDate);

    // Current failure
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_curr', 'c_1', 'renewal', 5000, 'failed')").run();

    const res = await GET(await mockRequest('http://localhost:3000/api/dashboard/metrics?days=14'));
    const json = await res.json();

    expect(json.range_totals.previous.failed_events_count).toBe(2);
    expect(json.range_totals.deltas.recovered_revenue_percent).toBeNull();
    expect(json.range_totals.deltas.recovery_rate_points).toBeNull();
    expect(json.range_totals.deltas.failed_amount_percent).toBeNull();
    expect(json.range_totals.deltas.customers_recovered_percent).toBeNull();
    expect(json.range_totals.deltas.needs_human_count).toBeNull();
  });

  it('5. valid days values: 7, 14, 30', async () => {
    for (const d of [7, 14, 30]) {
      const res = await GET(await mockRequest(`http://localhost:3000/api/dashboard/metrics?days=${d}`));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.range_days).toBe(d);
    }
  });

  it('6. invalid days values are rejected', async () => {
    for (const invalid of ['10', '0', '31', 'abc', '-5']) {
      const res = await GET(await mockRequest(`http://localhost:3000/api/dashboard/metrics?days=${invalid}`));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('invalid_query');
    }
  });

  it('7. policy audit reports 0 for valid data', async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_1', 'Alice', 'a@t', 'Pro', 5000, 30, 'healthy')").run();
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 5000, 'failed')").run();
    // Valid 20% discount on $50 Pro plan: 4000 cents
    db.prepare("INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, discount_percent, ladder_step, status) VALUES ('off_valid', 'c_1', 'be_1', 'partial_credit', 4000, 20, 0, 'offered')").run();

    const res = await GET(await mockRequest());
    const json = await res.json();

    expect(json.policy_audit.total_audited).toBe(1);
    expect(json.policy_audit.outside_policy_count).toBe(0);
    expect(json.policy_audit.violating_offer_ids).toEqual([]);
  });

  it('8. deliberately corrupt one offer and prove policy audit reports 1 outside-policy offer', async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_1', 'Alice', 'a@t', 'Pro', 5000, 30, 'healthy')").run();
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 5000, 'failed')").run();
    // Deliberately illegal offer: violates 100-cent floor (50 cents < 100 cents) and arithmetic mismatch
    db.prepare("INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, discount_percent, ladder_step, status) VALUES ('off_corrupt', 'c_1', 'be_1', 'partial_credit', 50, 20, 0, 'offered')").run();

    const res = await GET(await mockRequest());
    const json = await res.json();

    expect(json.policy_audit.total_audited).toBe(1);
    expect(json.policy_audit.outside_policy_count).toBe(1);
    expect(json.policy_audit.violating_offer_ids).toEqual(['off_corrupt']);
  });

  it('9. severity mapping correctly categorizes High, Medium, and Low', () => {
    expect(classifyEscalationReason(['forced escalate by keyword rule: dispute']).severity).toBe('High');
    expect(classifyEscalationReason(['forced escalate by keyword rule: chargeback']).severity).toBe('High');
    expect(classifyEscalationReason(['forced escalate by keyword rule: legal']).severity).toBe('High');
    expect(classifyEscalationReason(['forced escalate by keyword rule: fraud']).severity).toBe('High');
    expect(classifyEscalationReason(['forced escalate by keyword rule: human']).severity).toBe('Medium');
    expect(classifyEscalationReason(['forced escalate by keyword rule: anger']).severity).toBe('Medium');
    expect(classifyEscalationReason(['cancel intent >= 60 usage twice -> escalate']).severity).toBe('Low');
    expect(classifyEscalationReason([]).severity).toBe('Medium');
  });

  it('10. reason enum mapping using the REAL stored escalation clamp strings', () => {
    expect(classifyEscalationReason(['forced escalate by keyword rule: dispute']).reason).toBe('dispute');
    expect(classifyEscalationReason(['forced escalate by keyword rule: chargeback']).reason).toBe('chargeback');
    expect(classifyEscalationReason(['forced escalate by keyword rule: legal']).reason).toBe('legal');
    expect(classifyEscalationReason(['forced escalate by keyword rule: fraud']).reason).toBe('fraud');
    expect(classifyEscalationReason(['forced escalate by keyword rule: human']).reason).toBe('human_requested');
    expect(classifyEscalationReason(['forced escalate by keyword rule: anger']).reason).toBe('frustration');
    expect(classifyEscalationReason(['cancel intent >= 60 usage twice -> escalate']).reason).toBe('repeat_cancel');
    expect(classifyEscalationReason(['unknown']).reason).toBe('general_escalation');
  });

  it('11. ETag returns 304 when the resource has not changed', async () => {
    const res1 = await GET(await mockRequest()) as Response;
    expect(res1.status).toBe(200);
    const etag = res1.headers.get('ETag');
    expect(etag).toBeTruthy();

    const res2 = await GET(await mockRequest({ 'if-none-match': etag! })) as Response;
    expect(res2.status).toBe(304);
  });

  it('12. ETag changes when underlying dashboard data changes', async () => {
    const res1 = await GET(await mockRequest()) as Response;
    const etag1 = res1.headers.get('ETag');

    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_change', 'Changed', 'c@t', 'Pro', 5000, 10, 'healthy')").run();

    const res2 = await GET(await mockRequest()) as Response;
    const etag2 = res2.headers.get('ETag');
    expect(etag2).not.toBe(etag1);
  });

  it('13. response contains no email addresses', async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_secret', 'Confidential User', 'super_secret_email_12345@domain.com', 'Enterprise', 15000, 10, 'healthy')").run();

    const res = await GET(await mockRequest());
    const text = await res.text();

    expect(text).not.toContain('super_secret_email_12345@domain.com');
    expect(text).not.toContain('@domain.com');
  });

  it('14. response contains no PayPal order IDs', async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_1', 'Alice', 'a@t', 'Pro', 5000, 10, 'healthy')").run();
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 5000, 'failed')").run();
    db.prepare("INSERT INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id) VALUES ('r_1', 'c_1', 'be_1', 5000, 4000, 'PAYPAL_ORDER_SECRET_TOKEN_999')").run();

    const res = await GET(await mockRequest());
    const text = await res.text();

    expect(text).not.toContain('PAYPAL_ORDER_SECRET_TOKEN_999');
  });

  it('15. response contains no conversation text', async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_1', 'Alice', 'a@t', 'Pro', 5000, 10, 'healthy')").run();
    db.prepare("INSERT INTO conversations (id, customer_id, role, text, created_at) VALUES ('msg_1', 'c_1', 'customer', 'PROHIBITED_CONVERSATION_FREE_TEXT_BODY', '2026-01-01 10:00:00')").run();

    const res = await GET(await mockRequest());
    const text = await res.text();

    expect(text).not.toContain('PROHIBITED_CONVERSATION_FREE_TEXT_BODY');
  });

  it('16. response contains no model reasoning', async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_1', 'Alice', 'a@t', 'Pro', 5000, 10, 'healthy')").run();
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 5000, 'failed')").run();
    db.prepare("INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json) VALUES ('a_1', 'c_1', 'be_1', 'retry', 'SECRET_MODEL_CHAIN_OF_THOUGHT_REASONING', '{}')").run();

    const res = await GET(await mockRequest());
    const text = await res.text();

    expect(text).not.toContain('SECRET_MODEL_CHAIN_OF_THOUGHT_REASONING');
  });

  it('17. response keys are restricted to the approved contract', async () => {
    const res = await GET(await mockRequest());
    const json = await res.json();
    const approvedTopLevelKeys = [
      'range_days',
      'range_totals',
      'kpis',
      'daily_series',
      'sparklines',
      'intervention_mix',
      'funnel',
      'guardrail_summary',
      'policy_audit',
      'human_queue',
      'customers',
      'offers',
      'recoveries',
      'decisions'
    ];

    expect(Object.keys(json).sort()).toEqual(approvedTopLevelKeys.sort());
  });

  it('18. response values do not contain prohibited free text', async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_1', 'Safe Name', 'safe@test.com', 'Pro', 5000, 20, 'healthy')").run();
    db.prepare("INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 5000, 'failed')").run();
    db.prepare("INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json) VALUES ('a_1', 'c_1', 'be_1', 'partial_credit', 'Private internal notes', '{\"proposed_discount_percent\":50,\"approved_discount_percent\":20}')").run();

    const res = await GET(await mockRequest());
    const json = await res.json();

    // Verify customer shape
    expect(json.customers[0]).toHaveProperty('id');
    expect(json.customers[0]).toHaveProperty('name');
    expect(json.customers[0]).not.toHaveProperty('email');

    // Verify decisions shape
    expect(json.decisions[0]).not.toHaveProperty('reasoning');
    expect(json.decisions[0]).toHaveProperty('proposed_discount_percent');
    expect(json.decisions[0]).toHaveProperty('approved_discount_percent');
  });

  it('19. rate limiting works', async () => {
    const limit = 300;
    for (let i = 0; i < limit; i++) {
      const r = await GET(await mockRequest()) as Response;
      if (r.status === 429) {
        throw new Error('Hit limit prematurely');
      }
    }
    const res = await GET(await mockRequest()) as Response;
    expect(res.status).toBe(429);
  }, 15000);

  it('20. error responses expose only the approved short error code and no sensitive details', async () => {
    const db = getDb();
    vi.spyOn(db, 'prepare').mockImplementation(() => {
      throw new Error('Internal database file system failure at /var/secrets/sqlite.db');
    });

    const res = await GET(await mockRequest()) as Response;
    expect(res.status).toBe(500);
    const json = await res.json();

    expect(json).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(json)).not.toContain('/var/secrets');
  });
});

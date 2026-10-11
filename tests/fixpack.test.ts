import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDb } from '../src/lib/db';
import { GET as metricsGET } from '../src/app/api/dashboard/metrics/route';
import { POST as messagePOST } from '../src/app/api/agent/message/route';
import { resetRateLimitsForTests } from '../src/lib/rate-limit';
import { AIMessage } from '@langchain/core/messages';
import { ESCALATION_REASONS, mapEscalationSeverity, type EscalationReason } from '../src/lib/agent/guardrails';

vi.mock('../src/lib/paypal', () => ({
  createOrder: vi.fn().mockResolvedValue({ id: 'mock_order_fixpack', status: 'CREATED' }),
  captureOrder: vi.fn().mockResolvedValue({ status: 201, body: { purchase_units: [{ payments: { captures: [{ amount: { value: '25.00' } }] } }] } }),
  getOrder: vi.fn().mockResolvedValue({ status: 'COMPLETED' })
}));

vi.mock('@paypal/agent-toolkit/langchain', () => ({
  PayPalAgentToolkit: class {
    getTools() {
      return [{
        name: 'create_order',
        invoke: async () => JSON.stringify({ id: 'mock_order_fixpack', status: 'created' })
      }];
    }
  }
}));

let mockLlmIntent = 'negotiate';
let mockLlmReasoning = 'mock reasoning';

vi.mock('../src/lib/agent/llm', () => ({
  getLlm: () => ({
    bindTools() { return this; },
    withStructuredOutput() {
      return {
        invoke: async () => ({
          intent: mockLlmIntent,
          proposal: { action: 'partial_credit', discount_percent: 20, reasoning: mockLlmReasoning }
        })
      };
    },
    async invoke() {
      return new AIMessage('Your account has been flagged for our billing team, and a specialist will follow up with you by email shortly.');
    }
  })
}));

function mockReq(body?: any, ip = '127.0.0.1') {
  const headers = new Headers({ 'x-forwarded-for': ip });
  if (body) {
    return new Request('http://localhost:3000/api/agent/message', {
      method: 'POST',
      headers: { ...Object.fromEntries(headers.entries()), 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
  }
  return new Request('http://localhost:3000/api/dashboard/metrics', { headers });
}

describe('Fix Pack Tests: Dashboard Truthfulness', () => {
  beforeEach(() => {
    mockLlmIntent = 'negotiate';
    mockLlmReasoning = 'mock reasoning';
    const db = getDb();
    db.exec('DELETE FROM agent_actions; DELETE FROM conversations; DELETE FROM recoveries; DELETE FROM offers; DELETE FROM billing_events; DELETE FROM customers;');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetRateLimitsForTests();
  });

  // Item 1: Model label
  it('Item 1: Server serves configured LLM_MODEL non-secret from environment', async () => {
    const original = process.env.LLM_MODEL;
    process.env.LLM_MODEL = 'gemini-1.5-pro-preview';
    try {
      const res = await metricsGET(mockReq());
      const json = await (res as Response).json();
      expect(json.llm_model).toBe('gemini-1.5-pro-preview');
    } finally {
      process.env.LLM_MODEL = original;
    }
  });

  // Item 2: Escalation record & severity mapping
  it('Item 2a: Escalation enum and code severity mapping', () => {
    const expectedCategories: EscalationReason[] = [
      'dispute', 'chargeback', 'legal', 'fraud',
      'human_request', 'anger',
      'repeat_cancel', 'repeat_pushback', 'other'
    ];
    expect(ESCALATION_REASONS).toEqual(expectedCategories);

    // High severity
    expect(mapEscalationSeverity('dispute')).toBe('High');
    expect(mapEscalationSeverity('chargeback')).toBe('High');
    expect(mapEscalationSeverity('legal')).toBe('High');
    expect(mapEscalationSeverity('fraud')).toBe('High');

    // Medium severity
    expect(mapEscalationSeverity('human_request')).toBe('Medium');
    expect(mapEscalationSeverity('anger')).toBe('Medium');
    expect(mapEscalationSeverity('other')).toBe('Medium');

    // Low severity
    expect(mapEscalationSeverity('repeat_cancel')).toBe('Low');
    expect(mapEscalationSeverity('repeat_pushback')).toBe('Low');
  });

  it('Item 2b: Real route test for "this is a chargeback" stores Chargeback / High and counts in Keyword Escalation', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status)
      VALUES ('cust_cb', 'Carol Danvers', 'carol@test.com', 'Starter', 2500, 30, 'at_risk')
    `).run();
    db.prepare(`
      INSERT INTO billing_events (id, customer_id, type, amount_cents, status)
      VALUES ('bill_cb', 'cust_cb', 'renewal', 2500, 'failed')
    `).run();

    // Send customer message "this is a chargeback"
    const req = mockReq({
      customerId: 'cust_cb',
      billingEventId: 'bill_cb',
      text: 'this is a chargeback'
    });
    const res = await messagePOST(req);
    expect(res.status).toBe(200);

    // Verify stored agent_action record
    const action = db.prepare(`SELECT * FROM agent_actions WHERE customer_id = 'cust_cb' ORDER BY rowid DESC LIMIT 1`).get() as any;
    expect(action).toBeTruthy();
    expect(action.action).toBe('escalate');
    const details = JSON.parse(action.details_json);
    expect(details.reason_category).toBe('chargeback');
    expect(details.severity).toBe('High');

    // Verify Metrics Endpoint reads stored values
    const mRes = await metricsGET(mockReq());
    const mJson = await (mRes as Response).json();

    // Check Needs a human queue
    const humanItem = mJson.human_queue.find((h: any) => h.customer_id === 'cust_cb');
    expect(humanItem).toBeTruthy();
    expect(humanItem.reason_category).toBe('chargeback');
    expect(humanItem.severity).toBe('High');

    // Check Guardrail tile "Keyword Escalation"
    expect(mJson.guardrail_summary.escalated_by_keyword).toBe(1);
  });

  it('Item 2c: Test each escalation category through real route', async () => {
    const db = getDb();
    const categoriesToTest: { text: string; expectedCat: EscalationReason; expectedSev: string }[] = [
      { text: 'I will dispute this charge', expectedCat: 'dispute', expectedSev: 'High' },
      { text: 'I am contacting my legal attorney', expectedCat: 'legal', expectedSev: 'High' },
      { text: 'This is unauthorized fraud and theft', expectedCat: 'fraud', expectedSev: 'High' },
      { text: 'I need to speak to a real human supervisor', expectedCat: 'human_request', expectedSev: 'Medium' },
      { text: 'I am furious and livid about this service', expectedCat: 'anger', expectedSev: 'Medium' },
    ];

    for (let i = 0; i < categoriesToTest.length; i++) {
      const { text, expectedCat, expectedSev } = categoriesToTest[i];
      const custId = `c_cat_${i}`;
      const billId = `b_cat_${i}`;

      db.prepare(`
        INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status)
        VALUES (?, 'Test User', 'test@test.com', 'Starter', 2500, 30, 'at_risk')
      `).run(custId);
      db.prepare(`
        INSERT INTO billing_events (id, customer_id, type, amount_cents, status)
        VALUES (?, ?, 'renewal', 2500, 'failed')
      `).run(billId, custId);

      const res = await messagePOST(mockReq({ customerId: custId, billingEventId: billId, text }));
      expect(res.status).toBe(200);

      const action = db.prepare(`SELECT details_json FROM agent_actions WHERE customer_id = ? ORDER BY rowid DESC LIMIT 1`).get(custId) as any;
      const details = JSON.parse(action.details_json);
      expect(details.reason_category).toBe(expectedCat);
      expect(details.severity).toBe(expectedSev);
    }
  });

  // Item 3: Escalation supersedes all uncaptured offers
  it('Item 3: Escalation supersedes all open uncaptured offers and reflects in policy audit and funnel', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status)
      VALUES ('cust_esc', 'Escalated User', 'esc@test.com', 'Pro', 5000, 20, 'at_risk')
    `).run();
    db.prepare(`
      INSERT INTO billing_events (id, customer_id, type, amount_cents, status)
      VALUES ('bill_esc', 'cust_esc', 'renewal', 5000, 'failed')
    `).run();
    // Add pending offer and accepted uncaptured offer
    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, discount_percent, expires_at, status)
      VALUES ('off_pend', 'cust_esc', 'bill_esc', 'partial_credit', 4000, 20, '2099-01-01', 'pending')
    `).run();
    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, discount_percent, expires_at, status)
      VALUES ('off_acc', 'cust_esc', 'bill_esc', 'partial_credit', 3250, 35, '2099-01-01', 'accepted')
    `).run();

    // Now escalate
    mockLlmIntent = 'escalate';
    const req = mockReq({
      customerId: 'cust_esc',
      billingEventId: 'bill_esc',
      text: 'I want to speak to a manager immediately'
    });
    const res = await messagePOST(req);
    expect(res.status).toBe(200);

    // Verify no uncaptured non-superseded offer remains
    const openOffers = db.prepare(`
      SELECT * FROM offers WHERE customer_id = 'cust_esc' AND status NOT IN ('superseded', 'captured')
    `).all();
    expect(openOffers.length).toBe(0);

    // Both offers should now be 'superseded'
    const supersededOffers = db.prepare(`
      SELECT id, status FROM offers WHERE customer_id = 'cust_esc'
    `).all() as any[];
    expect(supersededOffers.every((o: any) => o.status === 'superseded')).toBe(true);

    // Check Metrics API policy audit and funnel
    const mRes = await metricsGET(mockReq());
    const mJson = await (mRes as Response).json();
    expect(mJson.funnel.offered).toBe(0);
    expect(mJson.funnel.accepted).toBe(0);
    expect(mJson.policy_audit.total_audited).toBe(0);
  });

  // Item 4: Funnel with confirmed pause and monotonic property
  it('Item 4: Funnel includes confirmed pause in accepted stage and maintains non-increasing monotonic property', async () => {
    const db = getDb();

    // 1. Recovered customer (Alice)
    db.prepare(`
      INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status)
      VALUES ('c_rec', 'Alice Smith', 'alice@test.com', 'Starter', 2500, 30, 'recovered')
    `).run();
    db.prepare(`
      INSERT INTO billing_events (id, customer_id, type, amount_cents, status)
      VALUES ('b_rec', 'c_rec', 'renewal', 2500, 'recovered')
    `).run();
    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, discount_percent, expires_at, status)
      VALUES ('off_rec', 'c_rec', 'b_rec', 'partial_credit', 2000, 20, '2099-01-01', 'captured')
    `).run();
    db.prepare(`
      INSERT INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id)
      VALUES ('rec_1', 'c_rec', 'b_rec', 2500, 2000, 'order_rec_1')
    `).run();

    // 2. Confirmed pause customer (George)
    db.prepare(`
      INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status)
      VALUES ('c_pau', 'George Costanza', 'george@test.com', 'Starter', 2500, 5, 'paused')
    `).run();
    db.prepare(`
      INSERT INTO billing_events (id, customer_id, type, amount_cents, status)
      VALUES ('b_pau', 'c_pau', 'renewal', 2500, 'paused')
    `).run();
    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, discount_percent, expires_at, status)
      VALUES ('off_pau', 'c_pau', 'b_pau', 'pause', 0, null, '2099-01-01', 'accepted')
    `).run();

    // 3. Escalated customer (Bob)
    db.prepare(`
      INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status)
      VALUES ('c_esc', 'Bob Jones', 'bob@test.com', 'Pro', 5000, 95, 'at_risk')
    `).run();
    db.prepare(`
      INSERT INTO billing_events (id, customer_id, type, amount_cents, status)
      VALUES ('b_esc', 'c_esc', 'renewal', 5000, 'failed')
    `).run();
    // Offer was superseded upon escalation
    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, discount_percent, expires_at, status)
      VALUES ('off_esc', 'c_esc', 'b_esc', 'retry', 5000, null, '2099-01-01', 'superseded')
    `).run();
    db.prepare(`
      INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json)
      VALUES ('act_esc', 'c_esc', 'b_esc', 'escalate', 'rule', '{"reason_category":"human_request","severity":"Medium","clamps":[]}')
    `).run();

    const mRes = await metricsGET(mockReq());
    const mJson = await (mRes as Response).json();

    const { failed, offered, accepted, paid } = mJson.funnel;

    // Verify raw logical counts:
    // 3 failed billing events
    expect(failed).toBe(3);
    // 2 active non-superseded offers (off_rec captured, off_pau accepted)
    expect(offered).toBe(2);
    // 2 accepted terms (Alice captured recovery + George confirmed pause)
    expect(accepted).toBe(2);
    // 1 payment captured recovery
    expect(paid).toBe(1);

    // Verify strict monotonic non-increasing invariant: failed >= offered >= accepted >= paid
    expect(failed).toBeGreaterThanOrEqual(offered);
    expect(offered).toBeGreaterThanOrEqual(accepted);
    expect(accepted).toBeGreaterThanOrEqual(paid);
  });

  // Item 6: Labels & Intervention formatting
  it('Item 6: Customer table intervention formats retry as "Retry payment"', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status)
      VALUES ('c_retry', 'Retry User', 'retry@test.com', 'Pro', 5000, 95, 'at_risk')
    `).run();
    db.prepare(`
      INSERT INTO billing_events (id, customer_id, type, amount_cents, status)
      VALUES ('b_retry', 'c_retry', 'renewal', 5000, 'failed')
    `).run();
    db.prepare(`
      INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json)
      VALUES ('act_retry', 'c_retry', 'b_retry', 'retry', 'plain retry', '{}')
    `).run();

    const mRes = await metricsGET(mockReq());
    const mJson = await (mRes as Response).json();

    const customerRow = mJson.customers.find((c: any) => c.id === 'c_retry');
    expect(customerRow).toBeTruthy();
    expect(customerRow.intervention).toBe('Retry payment');
  });
});

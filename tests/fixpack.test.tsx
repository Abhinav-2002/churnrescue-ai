// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { getDb } from '../src/lib/db';
import { GET as metricsGET } from '../src/app/api/dashboard/metrics/route';
import { POST as messagePOST } from '../src/app/api/agent/message/route';
import { POST as capturePOST } from '../src/app/api/offers/[offerId]/capture/route';
import { AIMessage } from '@langchain/core/messages';
import { ESCALATION_REASONS, mapEscalationSeverity, type EscalationReason } from '../src/lib/agent/guardrails';
import { GuardrailsPanel } from '../src/components/dashboard/GuardrailsPanel';
import { CustomersTable } from '../src/components/dashboard/CustomersTable';
import { HumanQueuePanel } from '../src/components/dashboard/HumanQueuePanel';
import { CustomerDrawer } from '../src/components/dashboard/CustomerDrawer';
import { StatusPill } from '../src/components/ui/StatusPill';
import CancelPage from '../src/app/cancel/page';
import ReturnPage from '../src/app/return/page';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('token=EC-TEST12345'),
  useRouter: () => ({ push: vi.fn() })
}));

vi.mock('../src/lib/paypal', () => ({
  createOrder: vi.fn().mockResolvedValue({ id: 'mock_order_fixpack', status: 'CREATED' }),
  captureOrder: vi.fn().mockResolvedValue({ status: 201, body: { purchase_units: [{ payments: { captures: [{ amount: { value: '25.00' } }] } }] } }),
  getOrder: vi.fn().mockResolvedValue({
    status: 'COMPLETED',
    purchase_units: [{ payments: { captures: [{ amount: { value: '25.00' } }] } }]
  })
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
    cleanup();
    vi.restoreAllMocks();
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

    // Check Metrics API policy audit and funnel (cust_esc received an offer, so offered=1, accepted=0, policy audit ignores superseded)
    const mRes = await metricsGET(mockReq());
    const mJson = await (mRes as Response).json();
    expect(mJson.funnel.offered).toBe(1);
    expect(mJson.funnel.accepted).toBe(0);
    expect(mJson.policy_audit.total_audited).toBe(0);
  });

  // FIX PACK 2 - Item 1: Escalation scope restricted to pending and accepted
  it('Item 1: Escalation restricts superseded status to pending and accepted offers', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status)
      VALUES ('cust_scope', 'Scope Test', 'scope@test.com', 'Starter', 2500, 30, 'at_risk')
    `).run();
    db.prepare(`
      INSERT INTO billing_events (id, customer_id, type, amount_cents, status)
      VALUES ('bill_scope', 'cust_scope', 'renewal', 2500, 'failed')
    `).run();

    const pastCapturingAt = new Date(Date.now() - 150000).toISOString();

    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, capturing_at, paypal_order_id, expires_at)
      VALUES ('off_capturing', 'cust_scope', 'bill_scope', 'partial_credit', 2500, 'capturing', ?, 'ord_capturing', '2099-01-01')
    `).run(pastCapturingAt);

    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, expires_at)
      VALUES ('off_needs_review', 'cust_scope', 'bill_scope', 'partial_credit', 2500, 'needs_review', '2099-01-01')
    `).run();

    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, expires_at)
      VALUES ('off_failed', 'cust_scope', 'bill_scope', 'partial_credit', 2500, 'failed', '2099-01-01')
    `).run();

    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, expires_at)
      VALUES ('off_declined', 'cust_scope', 'bill_scope', 'partial_credit', 2500, 'declined', '2099-01-01')
    `).run();

    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, expires_at)
      VALUES ('off_pend_1', 'cust_scope', 'bill_scope', 'partial_credit', 2500, 'pending', '2099-01-01')
    `).run();

    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, expires_at)
      VALUES ('off_acc_1', 'cust_scope', 'bill_scope', 'partial_credit', 2500, 'accepted', '2099-01-01')
    `).run();

    // Now escalate
    mockLlmIntent = 'escalate';
    const req = mockReq({
      customerId: 'cust_scope',
      billingEventId: 'bill_scope',
      text: 'this is a chargeback'
    });
    const res = await messagePOST(req);
    expect(res.status).toBe(200);

    // Verify non-pending, non-accepted offers preserved their status
    const oCapturing = db.prepare(`SELECT status FROM offers WHERE id = 'off_capturing'`).get() as any;
    expect(oCapturing.status).toBe('capturing');

    const oNeedsReview = db.prepare(`SELECT status FROM offers WHERE id = 'off_needs_review'`).get() as any;
    expect(oNeedsReview.status).toBe('needs_review');

    const oFailed = db.prepare(`SELECT status FROM offers WHERE id = 'off_failed'`).get() as any;
    expect(oFailed.status).toBe('failed');

    const oDeclined = db.prepare(`SELECT status FROM offers WHERE id = 'off_declined'`).get() as any;
    expect(oDeclined.status).toBe('declined');

    // Pending and accepted were superseded
    const oPend = db.prepare(`SELECT status FROM offers WHERE id = 'off_pend_1'`).get() as any;
    expect(oPend.status).toBe('superseded');

    const oAcc = db.prepare(`SELECT status FROM offers WHERE id = 'off_acc_1'`).get() as any;
    expect(oAcc.status).toBe('superseded');

    // Escalated customer has NO pending or accepted offers
    const openOffers = db.prepare(`
      SELECT * FROM offers WHERE customer_id = 'cust_scope' AND status IN ('pending', 'accepted')
    `).all();
    expect(openOffers.length).toBe(0);

    // Now reconcile finishes the recovery exactly once
    const capRes1 = await capturePOST(mockReq({}, 'POST'), { params: { offerId: 'off_capturing' } });
    expect(capRes1.status).toBe(200);
    const capJson1 = await capRes1.json();
    expect(capJson1.success).toBe(true);

    const recCount = db.prepare(`SELECT COUNT(*) as c FROM recoveries WHERE customer_id = 'cust_scope'`).get() as any;
    expect(recCount.c).toBe(1);

    // Second reconcile call is idempotent
    const capRes2 = await capturePOST(mockReq({}, 'POST'), { params: { offerId: 'off_capturing' } });
    expect(capRes2.status).toBe(200);
    const recCount2 = db.prepare(`SELECT COUNT(*) as c FROM recoveries WHERE customer_id = 'cust_scope'`).get() as any;
    expect(recCount2.c).toBe(1);
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
    // 3 customers received offers (off_rec captured, off_pau accepted, off_esc superseded)
    expect(offered).toBe(3);
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

  // FIX PACK 2 - Item 5: Guardrail panel copy test
  it('Item 5 (Fix Pack 2): Guardrail panel renders exactly the 4 real tiles with plain sentence descriptions and no raw enum names', () => {
    const summary = {
      pricing_adjustments: 3,
      blocked_suggestions: 13,
      escalated_by_keyword: 2,
      template_enforced: 1,
      total_checks: 19,
      latest_clamp_summary: 'Model proposed 50%, code allowed 20%'
    };
    render(<GuardrailsPanel summary={summary} audit={{ total_audited: 5, outside_policy_count: 0, violating_offer_ids: [] }} />);

    expect(screen.getByText('Discount Capped')).toBeTruthy();
    expect(screen.getByText('Forced Retry')).toBeTruthy();
    expect(screen.getByText('Keyword Escalation')).toBeTruthy();
    expect(screen.getByText('Template Used')).toBeTruthy();

    expect(screen.getByText("Decisions where a proposed discount was lowered to stay within policy limits.")).toBeTruthy();
    expect(screen.getByText("The code replaced the model's proposed action with a retry.")).toBeTruthy();
    expect(screen.getByText("Decisions where compliance or dispute keywords triggered an immediate handoff to human support.")).toBeTruthy();
    expect(screen.getByText("The model's wording was rejected and a safe template used.")).toBeTruthy();

    expect(screen.getByText('19 checks')).toBeTruthy();

    // No raw internal enum names rendered in the UI
    expect(screen.queryByText(/pricing_adjustments/i)).toBeNull();
    expect(screen.queryByText(/blocked_suggestions/i)).toBeNull();
    expect(screen.queryByText(/escalated_by_keyword/i)).toBeNull();
    expect(screen.queryByText(/template_enforced/i)).toBeNull();
    expect(screen.queryByText(/ladder_limited/i)).toBeNull();
    expect(screen.queryByText(/retry_forced/i)).toBeNull();
  });

  // FIX PACK 2 - Item 6: Funnel nested sets & data inconsistencies test
  it('Item 6 (Fix Pack 2): Funnel stages are nested sets with no min/clamping, and data_inconsistencies reports orphaned records', async () => {
    const db = getDb();
    // Deliberately inconsistent customer: recovery exists with billing event NOT in failed/recovered/paused
    db.prepare(`
      INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status)
      VALUES ('c_orphan', 'Orphan User', 'orphan@test.com', 'Starter', 2500, 30, 'recovered')
    `).run();
    db.prepare(`
      INSERT INTO billing_events (id, customer_id, type, amount_cents, status)
      VALUES ('b_orphan', 'c_orphan', 'renewal', 2500, 'disputed')
    `).run();
    db.prepare(`
      INSERT INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id)
      VALUES ('rec_orphan', 'c_orphan', 'b_orphan', 2500, 2000, 'order_orphan')
    `).run();

    const mRes = await metricsGET(mockReq());
    const mJson = await (mRes as Response).json();

    // Nested sets means:
    // Stage 1 (failed renewal customers): 0
    // Stage 2 (offered within failed): 0
    // Stage 3 (accepted within offered): 0
    // Stage 4 (recovered within accepted): 0
    // Monotonicity holds strictly: 0 >= 0 >= 0 >= 0 with NO clamping/min
    expect(mJson.funnel.failed).toBe(0);
    expect(mJson.funnel.offered).toBe(0);
    expect(mJson.funnel.accepted).toBe(0);
    expect(mJson.funnel.paid).toBe(0);

    // data_inconsistencies detects the orphaned recovery
    expect(mJson.funnel.data_inconsistencies).toBe(1);
  });

  // FIX PACK 3 - Item 4: Funnel with superseded offers included in Offered stage
  it('Item 4 (Fix Pack 3): Funnel counts all 6 failed customers who received offers, including superseded and declined', async () => {
    const db = getDb();
    // Reset DB tables for clean 6-customer fixture
    db.exec(`
      DELETE FROM agent_actions;
      DELETE FROM conversations;
      DELETE FROM recoveries;
      DELETE FROM offers;
      DELETE FROM billing_events;
      DELETE FROM customers;
    `);

    // 1. Alice Smith (captured, recovered)
    db.prepare(`INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_alice', 'Alice Smith', 'alice@test.com', 'Starter', 2500, 30, 'recovered')`).run();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('b_alice', 'c_alice', 'renewal', 2500, 'recovered')`).run();
    db.prepare(`INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status) VALUES ('off_alice', 'c_alice', 'b_alice', 'partial_credit', 1625, 'captured')`).run();
    db.prepare(`INSERT INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id) VALUES ('r_alice', 'c_alice', 'b_alice', 2500, 1625, 'ord_alice')`).run();

    // 2. Bob Jones (declined, failed)
    db.prepare(`INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_bob', 'Bob Jones', 'bob@test.com', 'Pro', 5000, 95, 'at_risk')`).run();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('b_bob', 'c_bob', 'renewal', 5000, 'failed')`).run();
    db.prepare(`INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status) VALUES ('off_bob', 'c_bob', 'b_bob', 'retry', 5000, 'declined')`).run();

    // 3. Diana Prince (escalated after offer -> superseded)
    db.prepare(`INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_diana', 'Diana Prince', 'diana@test.com', 'Pro', 5000, 45, 'at_risk')`).run();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('b_diana', 'c_diana', 'renewal', 5000, 'failed')`).run();
    db.prepare(`INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status) VALUES ('off_diana', 'c_diana', 'b_diana', 'partial_credit', 4000, 'superseded')`).run();
    db.prepare(`INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json) VALUES ('a_diana', 'c_diana', 'b_diana', 'escalate', 'Customer requested human agent', '{"reason_category":"dispute","severity":"High"}')`).run();

    // 4. Ethan Hunt (escalated after offer -> superseded)
    db.prepare(`INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_ethan', 'Ethan Hunt', 'ethan@test.com', 'Starter', 2500, 15, 'at_risk')`).run();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('b_ethan', 'c_ethan', 'renewal', 2500, 'failed')`).run();
    db.prepare(`INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status) VALUES ('off_ethan', 'c_ethan', 'b_ethan', 'partial_credit', 1625, 'superseded')`).run();
    db.prepare(`INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json) VALUES ('a_ethan', 'c_ethan', 'b_ethan', 'escalate', 'Customer wants supervisor', '{"reason_category":"human_request","severity":"Medium"}')`).run();

    // 5. George Costanza (pause accepted)
    db.prepare(`INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_george', 'George Costanza', 'george@test.com', 'Starter', 2500, 5, 'paused')`).run();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('b_george', 'c_george', 'renewal', 2500, 'paused')`).run();
    db.prepare(`INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status) VALUES ('off_george', 'c_george', 'b_george', 'pause', 0, 'accepted')`).run();

    // 6. Hannah Abbott (captured, recovered)
    db.prepare(`INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status) VALUES ('c_hannah', 'Hannah Abbott', 'hannah@test.com', 'Enterprise', 15000, 60, 'recovered')`).run();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('b_hannah', 'c_hannah', 'renewal', 15000, 'recovered')`).run();
    db.prepare(`INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status) VALUES ('off_hannah', 'c_hannah', 'b_hannah', 'retry', 15000, 'captured')`).run();
    db.prepare(`INSERT INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id) VALUES ('r_hannah', 'c_hannah', 'b_hannah', 15000, 15000, 'ord_hannah')`).run();

    const mRes = await metricsGET(mockReq());
    const mJson = await (mRes as Response).json();

    // Exact expected numbers:
    expect(mJson.funnel.failed).toBe(6);
    expect(mJson.funnel.offered).toBe(6);
    expect(mJson.funnel.accepted).toBe(3);
    expect(mJson.funnel.paid).toBe(2);
    expect(mJson.funnel.data_inconsistencies).toBe(0);
  });

  // FIX PACK 3 - Item 5: Real route execution for "this is a chargeback" verifies stored details_json metadata
  it('Item 5 (Fix Pack 3): Real route execution for "this is a chargeback" stores reason_category chargeback and severity High in details_json', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO customers (id, name, email, plan_name, plan_price_cents, usage_percent, status)
      VALUES ('cust_cb_fp3', 'Carol FP3', 'carol_fp3@test.com', 'Starter', 2500, 30, 'at_risk')
    `).run();
    db.prepare(`
      INSERT INTO billing_events (id, customer_id, type, amount_cents, status)
      VALUES ('bill_cb_fp3', 'cust_cb_fp3', 'renewal', 2500, 'failed')
    `).run();

    // Execute real route request with mocked LLM/PayPal
    const req = mockReq({
      customerId: 'cust_cb_fp3',
      billingEventId: 'bill_cb_fp3',
      text: 'this is a chargeback'
    });
    const res = await messagePOST(req);
    expect(res.status).toBe(200);

    // Verify stored agent_action record
    const action = db.prepare(`SELECT * FROM agent_actions WHERE customer_id = 'cust_cb_fp3' ORDER BY rowid DESC LIMIT 1`).get() as any;
    expect(action).toBeTruthy();
    expect(action.action).toBe('escalate');

    // Parse and verify details_json metadata
    const details = JSON.parse(action.details_json);
    expect(details.reason_category).toBe('chargeback');
    expect(details.severity).toBe('High');
    expect(details.clamps).toContain('forced escalate by keyword rule: chargeback');
    expect(details.template_used).toBe(true);
  });

  // FIX PACK 2 - Item 7: Status and intervention capitalization, and (UTC) on every time column header
  it('Item 7 (Fix Pack 2): Status and intervention capitalization, Retry payment, and (UTC) on every time column header', () => {
    // 1. Status capitalization
    const { container: s1 } = render(<StatusPill status="healthy" />);
    expect(s1.textContent).toBe('Healthy');
    cleanup();
    const { container: s2 } = render(<StatusPill status="at_risk" />);
    expect(s2.textContent).toBe('At Risk');
    cleanup();
    const { container: s3 } = render(<StatusPill status="recovered" />);
    expect(s3.textContent).toBe('Recovered');
    cleanup();
    const { container: s4 } = render(<StatusPill status="paused" />);
    expect(s4.textContent).toBe('Paused');
    cleanup();
    const { container: s5 } = render(<StatusPill status="escalated" />);
    expect(s5.textContent).toBe('Escalated');
    cleanup();

    const mockCustomer = {
      id: 'c_test',
      name: 'Test Customer',
      plan: 'Pro',
      price_cents: 5000,
      usage_percent: 45,
      status: 'at_risk',
      last_action: 'retry',
      last_action_at: '2026-10-11T10:00:00Z',
      failed_amount_cents: 5000,
      recovered_amount_cents: 0,
      intervention: 'Retry payment',
      updated_at: '2026-10-11T10:00:00Z'
    };

    // 2. CustomersTable has (UTC) header
    render(<CustomersTable customers={[mockCustomer as any]} />);
    expect(screen.getByText(/Updated \(UTC\)/i)).toBeTruthy();
    cleanup();

    // 3. HumanQueuePanel has (UTC) header
    const mockQueueItem = {
      customer_id: 'c_esc',
      name: 'Escalated Customer',
      reason_category: 'chargeback',
      severity: 'High' as const,
      failed_amount_cents: 5000,
      created_at: '2026-10-11T10:00:00Z'
    };
    render(<HumanQueuePanel queue={[mockQueueItem]} />);
    expect(screen.getByText(/Escalated \(UTC\)/i)).toBeTruthy();
    cleanup();

    // 4. CustomerDrawer has (UTC) in timestamps
    render(
      <CustomerDrawer
        customerId="c_test"
        customer={mockCustomer as any}
        decisions={[{
          customer_id: 'c_test',
          action: 'retry',
          proposed_discount_percent: 0,
          approved_discount_percent: 0,
          guardrail_category: null,
          ladder_step: null,
          created_at: '2026-10-11T10:00:00Z'
        }]}
        isOpen={true}
        onClose={() => {}}
      />
    );
    expect(screen.getAllByText(/UTC/i).length).toBeGreaterThanOrEqual(1);
    cleanup();
  });

  // FIX PACK 2 - Item 8: Cancel and return routes test
  it('Item 8 (Fix Pack 2): /cancel and /return routes render cleanly and expose no PayPal IDs or tokens', () => {
    // Cancel page
    const { container: cancelContainer } = render(<CancelPage />);
    expect(screen.getByText('Payment Cancelled')).toBeTruthy();
    expect(cancelContainer.textContent).not.toContain('EC-');
    expect(cancelContainer.textContent).not.toContain('ORDER-');
    expect(cancelContainer.textContent).not.toContain('token');
    cleanup();

    // Return page
    const { container: returnContainer } = render(<ReturnPage />);
    expect(screen.getByText(/Verifying Payment|Payment Completed!|Unable to Complete Payment/i)).toBeTruthy();
    expect(returnContainer.textContent).not.toContain('EC-TEST12345');
    expect(returnContainer.textContent).not.toContain('Order ID:');
    cleanup();
  });
});

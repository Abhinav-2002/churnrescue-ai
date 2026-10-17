import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as startPOST } from '../src/app/api/agent/start/route';
import { POST as messagePOST } from '../src/app/api/agent/message/route';
import { getDb, seedDb } from '../src/lib/db';
import { AIMessage } from '@langchain/core/messages';
import * as paypal from '../src/lib/paypal';

let llmCall = 0;
let activeStructuredOutputs: any[] = [];
let activeTexts: string[] = [];

vi.mock('../src/lib/paypal', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    createOrder: vi.fn().mockResolvedValue({ id: 'mock_order_paypal', status: 'CREATED' }),
    getOrder: vi.fn().mockResolvedValue({ status: 'APPROVED', purchase_units: [{ amount: { value: '12.50' } }] }),
    captureOrder: vi.fn().mockResolvedValue({ status: 200, body: { status: 'COMPLETED' } })
  };
});

vi.mock('../src/lib/agent/llm', () => ({
  getLlm: () => ({
    bindTools() { return this; },
    withStructuredOutput() {
      return {
        invoke: async () => {
          return activeStructuredOutputs[llmCall] || activeStructuredOutputs[0];
        }
      };
    },
    async invoke() {
      const txt = activeTexts[llmCall] || activeTexts[0];
      llmCall++;
      return new AIMessage(txt);
    }
  })
}));

describe('Fix Pack 8 — E2 & E3 Regression Tests', () => {
  beforeEach(() => {
    process.env.SQLITE_PATH = ':memory:';
    getDb();
    seedDb();
    llmCall = 0;
    activeStructuredOutputs = [];
    activeTexts = [];
    vi.clearAllMocks();
  });

  describe('E2 — Billing question preserves active offer', () => {
    it('at the floor ($12.50), "What is this charge for?" preserves $12.50, explains renewal, and does not claim final amount is $25.00', async () => {
      const db = getDb();
      db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', 'c_1');
      db.prepare('UPDATE customers SET usage_percent = 30 WHERE id = ?').run('c_1');
      db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('be_e2', 'c_1', 'renewal', 2500, 'failed');

      // Turn 0: start -> $20.00 (step 0)
      // Turn 1: negotiate -> $16.25 (step 1)
      // Turn 2: negotiate -> $12.50 (step 2 floor)
      // Turn 3: question -> Alice asks "What is this charge for?"
      activeStructuredOutputs = [
        { intent: 'propose', proposal: { action: 'partial_credit', discount_percent: 20, reasoning: 'start' } },
        { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 35, reasoning: 'turn 1' } },
        { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 50, reasoning: 'turn 2 floor' } },
        { intent: 'question', proposal: { action: 'retry', reasoning: 'customer asks about charge' } }
      ];
      activeTexts = [
        "Your Starter renewal of $25.00 didn't go through. I can offer you $20.00.",
        "I can improve that to $16.25.",
        "$12.50 is the best I can offer. Would you like to proceed? You can also pause your account if you need more time.",
        // Model unconstrained text that echoes the $25.00 retry from sysMsg
        "This charge is for your monthly Starter subscription. The original price is $25.00 and your new final amount is $25.00. Would you like to proceed?"
      ];

      const reqStart = { json: async () => ({ customerId: 'c_1' }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
      await startPOST(reqStart);

      await messagePOST({ json: async () => ({ customerId: 'c_1', text: "can you make it $10" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);
      await messagePOST({ json: async () => ({ customerId: 'c_1', text: "$10 i can afford" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);

      const offersBeforeQuestion = db.prepare("SELECT * FROM offers WHERE customer_id = 'c_1'").all() as any[];
      expect(offersBeforeQuestion).toHaveLength(3);
      const floorOffer = offersBeforeQuestion[2];
      expect(floorOffer.amount_cents).toBe(1250);
      expect(floorOffer.ladder_step).toBe(2);
      expect(floorOffer.status).toBe('pending');

      // Turn 3: Ask "What is this charge for?"
      const resQuestion = await messagePOST({ json: async () => ({ customerId: 'c_1', text: "What is this charge for?" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);
      const jsonQuestion = await resQuestion.json();

      // 1. Receives an informational answer explaining renewal
      expect(jsonQuestion.reply).toMatch(/renewal|subscription/i);

      // 2. Preserves and restates the existing $12.50 offer
      expect(jsonQuestion.reply).toContain('$12.50');

      // 3. Response must NOT claim the new final amount is the original $25.00 price
      expect(jsonQuestion.reply).not.toMatch(/(final amount|rate|due|instead of).*(\$25|\$25\.00)/i);

      // 4. The active offer remains unchanged ($12.50, pending)
      const offersAfterQuestion = db.prepare("SELECT * FROM offers WHERE customer_id = 'c_1'").all() as any[];
      expect(offersAfterQuestion).toHaveLength(3);
      expect(offersAfterQuestion[2].id).toBe(floorOffer.id);
      expect(offersAfterQuestion[2].status).toBe('pending');
      expect(offersAfterQuestion[2].amount_cents).toBe(1250);
      expect(offersAfterQuestion[2].ladder_step).toBe(2);

      // 5. No PayPal order, capture, or payment initiated
      expect(paypal.createOrder).not.toHaveBeenCalled();

      // 6. No escalation recorded
      const escalateActions = db.prepare("SELECT * FROM agent_actions WHERE customer_id = 'c_1' AND action = 'escalate'").all();
      expect(escalateActions).toHaveLength(0);

      // 7. Customer remains at_risk
      const customer = db.prepare("SELECT status FROM customers WHERE id = 'c_1'").get() as any;
      expect(customer.status).toBe('at_risk');
    });
  });

  describe('E3 — Declining an offer', () => {
    it('Test A: first decline acknowledges refusal, mentions pause once, creates no new offer, and does not retry at $25.00', async () => {
      const db = getDb();
      db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', 'c_1');
      db.prepare('UPDATE customers SET usage_percent = 30 WHERE id = ?').run('c_1');
      db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('be_e3_a', 'c_1', 'renewal', 2500, 'failed');

      // Turn 0: start -> $20.00
      // Turn 1: decline ("no thanks")
      activeStructuredOutputs = [
        { intent: 'propose', proposal: { action: 'partial_credit', discount_percent: 20, reasoning: 'start' } },
        { intent: 'decline', proposal: { action: 'retry', reasoning: 'customer declined' } }
      ];
      activeTexts = [
        "Your Starter renewal of $25.00 didn't go through. I can offer you $20.00.",
        // Model unconstrained text that attempts to force full-price retry
        "Your subscription rate of $25.00 remains due. Would you like to retry the payment at $25.00?"
      ];

      const reqStart = { json: async () => ({ customerId: 'c_1' }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
      await startPOST(reqStart);

      const offersAfterStart = db.prepare("SELECT * FROM offers WHERE customer_id = 'c_1'").all() as any[];
      expect(offersAfterStart).toHaveLength(1);
      expect(offersAfterStart[0].amount_cents).toBe(2000);
      expect(offersAfterStart[0].ladder_step).toBe(0);

      // Submit "no thanks"
      const resDecline = await messagePOST({ json: async () => ({ customerId: 'c_1', text: "no thanks" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);
      const jsonDecline = await resDecline.json();

      // 1. Acknowledges refusal politely
      expect(jsonDecline.reply).toMatch(/understand|no problem|apologize|sorry/i);

      // 2. Mentions pause exactly once
      const pauseMatches = (jsonDecline.reply.match(/pause/gi) || []).length;
      expect(pauseMatches).toBe(1);

      // 3. Does not demand full price retry at $25.00
      expect(jsonDecline.reply).not.toMatch(/retry.*\$25/i);
      expect(jsonDecline.reply).not.toMatch(/\$25\.?0?0? remains due/i);

      // 4. Offers count stays at 1 and no $16.25 offer appears
      const offersAfterDecline = db.prepare("SELECT * FROM offers WHERE customer_id = 'c_1'").all() as any[];
      expect(offersAfterDecline).toHaveLength(1);
      expect(offersAfterDecline[0].amount_cents).toBe(2000);
      expect(offersAfterDecline[0].ladder_step).toBe(0);

      // 5. No payment retry, PayPal order, capture, or escalation
      expect(paypal.createOrder).not.toHaveBeenCalled();
      const escalateActions = db.prepare("SELECT * FROM agent_actions WHERE customer_id = 'c_1' AND action = 'escalate'").all();
      expect(escalateActions).toHaveLength(0);

      // 6. Alice remains at_risk and is not recovered
      const customer = db.prepare("SELECT status FROM customers WHERE id = 'c_1'").get() as any;
      expect(customer.status).toBe('at_risk');
    });

    it('Test B: repeated decline remains safe, creates no new offer, does not advance ladder, and does not retry at $25.00', async () => {
      const db = getDb();
      db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', 'c_1');
      db.prepare('UPDATE customers SET usage_percent = 30 WHERE id = ?').run('c_1');
      db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('be_e3_b', 'c_1', 'renewal', 2500, 'failed');

      // Turn 0: start -> $20.00
      // Turn 1: decline ("no thanks")
      // Turn 2: decline ("no thanks" again)
      activeStructuredOutputs = [
        { intent: 'propose', proposal: { action: 'partial_credit', discount_percent: 20, reasoning: 'start' } },
        { intent: 'decline', proposal: { action: 'retry', reasoning: 'customer declined 1' } },
        { intent: 'decline', proposal: { action: 'retry', reasoning: 'customer declined 2' } }
      ];
      activeTexts = [
        "Your Starter renewal of $25.00 didn't go through. I can offer you $20.00.",
        "I understand you don't wish to proceed with this offer. You can also pause your account if you need more time.",
        // Second decline: model tries to repeat full-price retry
        "Your subscription rate of $25.00 remains due. Would you like to retry the payment at $25.00?"
      ];

      const reqStart = { json: async () => ({ customerId: 'c_1' }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
      await startPOST(reqStart);

      // First decline
      await messagePOST({ json: async () => ({ customerId: 'c_1', text: "no thanks" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);

      // Second decline
      const resDecline2 = await messagePOST({ json: async () => ({ customerId: 'c_1', text: "no thanks" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);
      const jsonDecline2 = await resDecline2.json();

      // 1. Offers count stays at 1 (no new discount offer created)
      const offersAfterDecline2 = db.prepare("SELECT * FROM offers WHERE customer_id = 'c_1'").all() as any[];
      expect(offersAfterDecline2).toHaveLength(1);
      expect(offersAfterDecline2[0].amount_cents).toBe(2000);
      expect(offersAfterDecline2[0].ladder_step).toBe(0);

      // 2. No payment attempted or PayPal order
      expect(paypal.createOrder).not.toHaveBeenCalled();

      // 3. No full-price retry or agreement implied
      expect(jsonDecline2.reply).not.toMatch(/retry.*\$25/i);
      expect(jsonDecline2.reply).not.toMatch(/\$25\.?0?0? remains due/i);

      // 4. Customer not incorrectly escalated or recovered
      expect(jsonDecline2.nextStep).not.toBe('escalated');
      const escalateActions = db.prepare("SELECT * FROM agent_actions WHERE customer_id = 'c_1' AND action = 'escalate'").all();
      expect(escalateActions).toHaveLength(0);

      const customer = db.prepare("SELECT status FROM customers WHERE id = 'c_1'").get() as any;
      expect(customer.status).toBe('at_risk');
    });
  });
});

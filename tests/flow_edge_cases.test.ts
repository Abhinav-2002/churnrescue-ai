import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as startPOST } from '../src/app/api/agent/start/route';
import { POST as messagePOST } from '../src/app/api/agent/message/route';
import { POST as confirmPausePOST } from '../src/app/api/agent/confirm-pause/route';
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

describe('Fix Pack 7: Flow Edge Cases', () => {
  beforeEach(() => {
    process.env.SQLITE_PATH = ':memory:';
    getDb();
    seedDb();
    llmCall = 0;
    activeStructuredOutputs = [];
    activeTexts = [];
    vi.clearAllMocks();
  });

  it('a. At ladder step 2 (offer $12.50, "best I can offer"), the message "can I pause my account instead" (mocked classification: pause_request) returns nextStep confirm_pause with a pause offer and creates NO escalate action; confirming sets the customer to paused', async () => {
    const db = getDb();
    db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', 'c_1');
    db.prepare('UPDATE customers SET usage_percent = 30 WHERE id = ?').run('c_1');
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('be_fp7_a', 'c_1', 'renewal', 2500, 'failed');

    // Turn 0: start -> $20.00 (step 0)
    // Turn 1: negotiate -> $16.25 (step 1)
    // Turn 2: negotiate -> $12.50 (step 2 floor)
    // Turn 3: pause_request -> confirm_pause
    activeStructuredOutputs = [
      { intent: 'propose', proposal: { action: 'partial_credit', discount_percent: 20, reasoning: 'start' } },
      { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 35, reasoning: 'turn 1' } },
      { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 50, reasoning: 'turn 2 floor' } },
      { intent: 'pause_request', proposal: { action: 'pause', reasoning: 'customer asked to pause' } }
    ];
    activeTexts = [
      "Your Starter renewal of $25.00 didn't go through. I can offer you $20.00.",
      "I can improve that to $16.25.",
      "$12.50 is the best I can offer. Would you like to proceed? You can also pause your account if you need more time.",
      "Your subscription will be paused with no charge. Please confirm if you want to proceed."
    ];

    const reqStart = { json: async () => ({ customerId: 'c_1' }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
    await startPOST(reqStart);

    const reqMsg1 = { json: async () => ({ customerId: 'c_1', text: "can you make it $10" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
    await messagePOST(reqMsg1);

    const reqMsg2 = { json: async () => ({ customerId: 'c_1', text: "$10 i can afford" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
    await messagePOST(reqMsg2);

    const reqMsg3 = { json: async () => ({ customerId: 'c_1', text: "can I pause my account instead" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
    const resMsg3 = await messagePOST(reqMsg3);
    const jsonMsg3 = await resMsg3.json();

    // Must return nextStep: 'confirm_pause' with a pause offer
    expect(jsonMsg3.nextStep).toBe('confirm_pause');
    expect(jsonMsg3.offerId).toBeDefined();

    // Creates NO escalate action
    const actions = db.prepare("SELECT * FROM agent_actions WHERE customer_id = 'c_1' AND action = 'escalate'").all();
    expect(actions).toHaveLength(0);

    // Latest offer is pause
    const latestOffer = db.prepare("SELECT * FROM offers WHERE id = ?").get(jsonMsg3.offerId) as any;
    expect(latestOffer.kind).toBe('pause');
    expect(latestOffer.status).toBe('pending');

    // Confirming sets the customer to paused
    const reqConfirm = { json: async () => ({ customerId: 'c_1', offerId: jsonMsg3.offerId }) } as any;
    const resConfirm = await confirmPausePOST(reqConfirm);
    const jsonConfirm = await resConfirm.json();
    expect(jsonConfirm.success).toBe(true);

    const customer = db.prepare("SELECT status FROM customers WHERE id = 'c_1'").get() as any;
    expect(customer.status).toBe('paused');
  });

  it('b. At step 2, a question ("what is this charge for?", mocked classification: question) restates the $12.50 offer; no escalation, no new offer row', async () => {
    const db = getDb();
    db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', 'c_1');
    db.prepare('UPDATE customers SET usage_percent = 30 WHERE id = ?').run('c_1');
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('be_fp7_b', 'c_1', 'renewal', 2500, 'failed');

    // Reach step 2
    activeStructuredOutputs = [
      { intent: 'propose', proposal: { action: 'partial_credit', discount_percent: 20, reasoning: 'start' } },
      { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 35, reasoning: 'turn 1' } },
      { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 50, reasoning: 'turn 2 floor' } },
      { intent: 'question', proposal: { action: 'retry', reasoning: 'customer asked a question' } }
    ];
    activeTexts = [
      "Your Starter renewal of $25.00 didn't go through. I can offer you $20.00.",
      "I can improve that to $16.25.",
      "$12.50 is the best I can offer. Would you like to proceed? You can also pause your account if you need more time.",
      "This is for your monthly Starter renewal. Our best offer is $12.50, or you can pause your subscription."
    ];

    const reqStart = { json: async () => ({ customerId: 'c_1' }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
    await startPOST(reqStart);
    await messagePOST({ json: async () => ({ customerId: 'c_1', text: "can you make it $10" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);
    await messagePOST({ json: async () => ({ customerId: 'c_1', text: "$10 i can afford" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);

    const offersBefore = db.prepare("SELECT * FROM offers WHERE customer_id = 'c_1'").all();
    expect(offersBefore).toHaveLength(3);

    // Ask question
    const resMsg = await messagePOST({ json: async () => ({ customerId: 'c_1', text: "what is this charge for?" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);
    const jsonMsg = await resMsg.json();

    // No escalation
    expect(jsonMsg.nextStep).not.toBe('escalated');
    const escalateActions = db.prepare("SELECT * FROM agent_actions WHERE customer_id = 'c_1' AND action = 'escalate'").all();
    expect(escalateActions).toHaveLength(0);

    // No new offer row
    const offersAfter = db.prepare("SELECT * FROM offers WHERE customer_id = 'c_1'").all();
    expect(offersAfter).toHaveLength(3);

    // Customer still at_risk
    const customer = db.prepare("SELECT status FROM customers WHERE id = 'c_1'").get() as any;
    expect(customer.status).toBe('at_risk');
  });

  it('c. At step 0, "no thanks" (mocked classification: decline) creates no new discount offer; the offers count stays 1 and the reply acknowledges and mentions pause once', async () => {
    const db = getDb();
    db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', 'c_1');
    db.prepare('UPDATE customers SET usage_percent = 30 WHERE id = ?').run('c_1');
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('be_fp7_c', 'c_1', 'renewal', 2500, 'failed');

    activeStructuredOutputs = [
      { intent: 'propose', proposal: { action: 'partial_credit', discount_percent: 20, reasoning: 'start' } },
      { intent: 'decline', proposal: { action: 'retry', reasoning: 'customer declined offer' } }
    ];
    activeTexts = [
      "Your Starter renewal of $25.00 didn't go through. I can offer you $20.00.",
      "I understand you don't wish to proceed with this offer. You can also pause your account if you need more time."
    ];

    const reqStart = { json: async () => ({ customerId: 'c_1' }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
    await startPOST(reqStart);

    const offersAfterStart = db.prepare("SELECT * FROM offers WHERE customer_id = 'c_1'").all();
    expect(offersAfterStart).toHaveLength(1);
    expect(offersAfterStart[0].amount_cents).toBe(2000);

    // Send "no thanks" (decline)
    const resDecline = await messagePOST({ json: async () => ({ customerId: 'c_1', text: "no thanks" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);
    const jsonDecline = await resDecline.json();

    // Offers count stays 1 (no new discount offer created)
    const offersAfterDecline = db.prepare("SELECT * FROM offers WHERE customer_id = 'c_1'").all();
    expect(offersAfterDecline).toHaveLength(1);
    expect(offersAfterDecline[0].amount_cents).toBe(2000);

    // Reply acknowledges and mentions pause
    expect(jsonDecline.reply).toMatch(/pause/i);
    // Mention pause only once
    const pauseMatches = (jsonDecline.reply.match(/pause/gi) || []).length;
    expect(pauseMatches).toBe(1);
  });

  it('d. At step 2, a further price pushback escalates, and accept still creates the order at $12.50 with a Request-Id derived from the offer id', async () => {
    const db = getDb();
    db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', 'c_1');
    db.prepare('UPDATE customers SET usage_percent = 30 WHERE id = ?').run('c_1');
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('be_fp7_d', 'c_1', 'renewal', 2500, 'failed');

    // Reach step 2
    activeStructuredOutputs = [
      { intent: 'propose', proposal: { action: 'partial_credit', discount_percent: 20, reasoning: 'start' } },
      { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 35, reasoning: 'turn 1' } },
      { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 50, reasoning: 'turn 2 floor' } },
      { intent: 'negotiate', proposal: { action: 'retry', reasoning: 'further pushback at floor' } }
    ];
    activeTexts = [
      "Your Starter renewal of $25.00 didn't go through. I can offer you $20.00.",
      "I can improve that to $16.25.",
      "$12.50 is the best I can offer. Would you like to proceed? You can also pause your account if you need more time.",
      "Your account has been flagged for our billing team, and a specialist will follow up with you by email shortly."
    ];

    await startPOST({ json: async () => ({ customerId: 'c_1' }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);
    await messagePOST({ json: async () => ({ customerId: 'c_1', text: "can you make it $10" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);
    await messagePOST({ json: async () => ({ customerId: 'c_1', text: "$10 i can afford" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);

    // Pushback at step 2 escalates
    const resEscalate = await messagePOST({ json: async () => ({ customerId: 'c_1', text: "still too much" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);
    const jsonEscalate = await resEscalate.json();
    expect(jsonEscalate.nextStep).toBe('escalated');

    const lastAction = db.prepare("SELECT * FROM agent_actions WHERE customer_id = 'c_1' ORDER BY rowid DESC LIMIT 1").get() as any;
    expect(lastAction.action).toBe('escalate');

    // Test accept at step 2: on a fresh customer c_1, drive to step 2 and accept
    db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', 'c_1');
    db.prepare('DELETE FROM offers WHERE customer_id = ?').run('c_1');
    db.prepare('DELETE FROM conversations WHERE customer_id = ?').run('c_1');
    db.prepare('DELETE FROM agent_actions WHERE customer_id = ?').run('c_1');
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('be_fp7_d2', 'c_1', 'renewal', 2500, 'failed');

    llmCall = 0;
    activeStructuredOutputs = [
      { intent: 'propose', proposal: { action: 'partial_credit', discount_percent: 20, reasoning: 'start' } },
      { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 35, reasoning: 'turn 1' } },
      { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 50, reasoning: 'turn 2 floor' } },
      { intent: 'accept', proposal: { action: 'partial_credit', reasoning: 'customer accepts' } }
    ];
    activeTexts = [
      "Your Starter renewal of $25.00 didn't go through. I can offer you $20.00.",
      "I can improve that to $16.25.",
      "$12.50 is the best I can offer. Would you like to proceed? You can also pause your account if you need more time.",
      "Your amount of $12.50 is confirmed. A PayPal button is below."
    ];

    await startPOST({ json: async () => ({ customerId: 'c_1' }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);
    await messagePOST({ json: async () => ({ customerId: 'c_1', text: "can you make it $10" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);
    await messagePOST({ json: async () => ({ customerId: 'c_1', text: "$10 i can afford" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);

    const step2Offer = db.prepare("SELECT * FROM offers WHERE customer_id = 'c_1' AND status = 'pending'").get() as any;
    expect(step2Offer.amount_cents).toBe(1250);

    const resAccept = await messagePOST({ json: async () => ({ customerId: 'c_1', text: "yes" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);
    const jsonAccept = await resAccept.json();

    expect(jsonAccept.nextStep).toBe('pay');
    expect(jsonAccept.amountCents).toBe(1250);
    expect(paypal.createOrder).toHaveBeenCalledWith(
      1250,
      'USD',
      step2Offer.id,
      `offer_${step2Offer.id}`
    );
  });

  it('e. High usage unchanged: Bob\'s discount request is refused, the second pushback escalates', async () => {
    const db = getDb();
    // Bob is c_2: Pro, 5000 cents, 80% usage
    db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', 'c_2');
    db.prepare('UPDATE customers SET usage_percent = 80 WHERE id = ?').run('c_2');
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('be_fp7_e', 'c_2', 'renewal', 5000, 'failed');

    // Bob turn 0: start -> full price retry
    // Bob turn 1: discount request ("can I have a discount") -> refused (retry at $50.00)
    // Bob turn 2: second pushback ("no, give me a discount") -> escalates
    activeStructuredOutputs = [
      { intent: 'propose', proposal: { action: 'retry', reasoning: 'start high usage' } },
      { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 20, reasoning: 'bob asks for discount' } },
      { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 20, reasoning: 'bob second pushback' } }
    ];
    activeTexts = [
      "Your Pro renewal of $50.00 didn't go through. Would you like to retry the payment at $50.00?",
      "Your Pro renewal of $50.00 didn't go through. Would you like to retry the payment at $50.00?",
      "Your account has been flagged for our billing team, and a specialist will follow up with you by email shortly."
    ];

    await startPOST({ json: async () => ({ customerId: 'c_2' }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);

    // Pushback 1: refused (retry)
    const resMsg1 = await messagePOST({ json: async () => ({ customerId: 'c_2', text: "can I get a discount?" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);
    const jsonMsg1 = await resMsg1.json();
    expect(jsonMsg1.nextStep).not.toBe('escalated');

    const actionsAfter1 = db.prepare("SELECT * FROM agent_actions WHERE customer_id = 'c_2' ORDER BY rowid DESC LIMIT 1").get() as any;
    expect(actionsAfter1.action).toBe('retry');

    // Pushback 2: escalates
    const resMsg2 = await messagePOST({ json: async () => ({ customerId: 'c_2', text: "no, give me a discount" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);
    const jsonMsg2 = await resMsg2.json();
    expect(jsonMsg2.nextStep).toBe('escalated');

    const actionsAfter2 = db.prepare("SELECT * FROM agent_actions WHERE customer_id = 'c_2' ORDER BY rowid DESC LIMIT 1").get() as any;
    expect(actionsAfter2.action).toBe('escalate');
  });
});

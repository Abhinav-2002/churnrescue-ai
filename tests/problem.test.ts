import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as startPOST } from '../src/app/api/agent/start/route';
import { POST as messagePOST } from '../src/app/api/agent/message/route';
import { getDb, seedDb } from '../src/lib/db';
import { AIMessage } from '@langchain/core/messages';

let llmCall = 0;
const defaultStructuredOutputs = [
  { intent: 'propose', proposal: { action: 'partial_credit', discount_percent: 20, reasoning: 'mock' } },
  { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 35, reasoning: 'mock' } },
  { intent: 'negotiate', proposal: { action: 'retry', reasoning: 'mock' } },
  { intent: 'negotiate', proposal: { action: 'retry', reasoning: 'mock' } }
];

const defaultTexts = [
  "Your Starter renewal of $25.00 didn't go through. I can offer you $20.00.",
  "I can improve that to $16.25.",
  "the lowest possible rate I can offer ... is $25.00 ... we can retry the transaction at this rate.",
  "the lowest possible rate I can offer ... is $25.00 ... we can retry the transaction at this rate."
];

let activeStructuredOutputs = defaultStructuredOutputs;
let activeTexts = defaultTexts;

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

describe('Problem Sequence', () => {
  beforeEach(() => {
    process.env.SQLITE_PATH = ':memory:';
    getDb();
    seedDb();
    llmCall = 0;
    activeStructuredOutputs = defaultStructuredOutputs;
    activeTexts = defaultTexts;
  });

  it('drives the problem sequence and fails on invariants', async () => {
    const db = getDb();
    db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', 'c_1');
    // c_1 is Starter, 30% usage (explicitly ensured for test isolation)
    db.prepare('UPDATE customers SET usage_percent = 30 WHERE id = ?').run('c_1');
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('be_1', 'c_1', 'renewal', 2500, 'failed');

    const reqStart = () => ({ json: async () => ({ customerId: 'c_1' }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);
    
    await Promise.all([startPOST(reqStart()), startPOST(reqStart())]);

    const reqMsg1 = { json: async () => ({ customerId: 'c_1', text: "can yo make it $10" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
    await messagePOST(reqMsg1);

    const reqMsg2 = { json: async () => ({ customerId: 'c_1', text: "$10 i can aford" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
    await messagePOST(reqMsg2);

    const reqMsg3 = { json: async () => ({ customerId: 'c_1', text: "still too much" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
    const resMsg3 = await messagePOST(reqMsg3);
    const jsonMsg3 = await resMsg3.json();

    const msgs = db.prepare('SELECT * FROM conversations WHERE customer_id = ? ORDER BY rowid ASC').all('c_1') as any[];
    const agentMsgs = msgs.filter(m => m.role === 'agent' && m.text !== '[SYSTEM_CLAIM]');

    const firstMsgs = agentMsgs.filter(m => m.text.includes('didn\'t go through'));
    expect(firstMsgs.length).toBe(1);

    const offers = db.prepare('SELECT * FROM offers WHERE customer_id = ? ORDER BY rowid ASC').all('c_1') as any[];
    expect(offers).toHaveLength(3);
    expect(offers[0].amount_cents).toBe(2000);
    expect(offers[1].amount_cents).toBe(1625);
    expect(offers[2].amount_cents).toBe(1250);
    expect(offers[0].status).toBe('superseded');
    expect(offers[1].status).toBe('superseded');
    expect(offers[2].status).toBe('superseded');
    expect(agentMsgs[1].text).not.toMatch(/lowest|best/i);
    expect(agentMsgs[2].text).toContain('best I can offer');
    expect(agentMsgs[2].text).toMatch(/pause/i);
    expect(offers[1].amount_cents).toBeLessThanOrEqual(offers[0].amount_cents);
    expect(offers[2].amount_cents).toBeLessThanOrEqual(offers[1].amount_cents);

    expect(jsonMsg3.nextStep).toBe('escalated');
    const lastAction = db.prepare("SELECT * FROM agent_actions WHERE customer_id = 'c_1' ORDER BY rowid DESC LIMIT 1").get() as any;
    expect(lastAction.action).toBe('escalate');

    const openOffers = db.prepare("SELECT * FROM offers WHERE customer_id = 'c_1' AND status IN ('pending', 'accepted')").all();
    expect(openOffers).toHaveLength(0);
  });

  it('clamps model that proposes 50% discount on first turn and retry on later turns to 2000, 1625, 1250', async () => {
    activeStructuredOutputs = [
      { intent: 'propose', proposal: { action: 'partial_credit', discount_percent: 50, reasoning: 'model proposes 50% first' } },
      { intent: 'negotiate', proposal: { action: 'retry', reasoning: 'model proposes retry' } },
      { intent: 'negotiate', proposal: { action: 'retry', reasoning: 'model proposes retry' } },
      { intent: 'negotiate', proposal: { action: 'retry', reasoning: 'model proposes retry' } }
    ];
    activeTexts = [
      "Your Starter renewal of $25.00 didn't go through. I can offer you $12.50.",
      "The lowest rate is $25.00.",
      "The lowest rate is $25.00.",
      "The lowest rate is $25.00."
    ];

    const db = getDb();
    db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', 'c_1');
    db.prepare('UPDATE customers SET usage_percent = 30 WHERE id = ?').run('c_1');
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('be_2', 'c_1', 'renewal', 2500, 'failed');

    const reqStart = { json: async () => ({ customerId: 'c_1' }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
    await startPOST(reqStart);

    const reqMsg1 = { json: async () => ({ customerId: 'c_1', text: "can you do better" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
    await messagePOST(reqMsg1);

    const reqMsg2 = { json: async () => ({ customerId: 'c_1', text: "$10 i can afford" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
    await messagePOST(reqMsg2);

    const reqMsg3 = { json: async () => ({ customerId: 'c_1', text: "still too much" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
    const resMsg3 = await messagePOST(reqMsg3);
    const jsonMsg3 = await resMsg3.json();

    const agentMsgs = db.prepare("SELECT * FROM conversations WHERE customer_id = ? AND role = 'agent' AND text != '[SYSTEM_CLAIM]' ORDER BY rowid ASC").all('c_1') as any[];
    expect(agentMsgs[2].text).toContain('best I can offer');
    expect(agentMsgs[2].text).toMatch(/pause/i);

    expect(jsonMsg3.nextStep).toBe('escalated');
    const lastAction = db.prepare("SELECT * FROM agent_actions WHERE customer_id = 'c_1' ORDER BY rowid DESC LIMIT 1").get() as any;
    expect(lastAction.action).toBe('escalate');

    const openOffers = db.prepare("SELECT * FROM offers WHERE customer_id = 'c_1' AND status IN ('pending', 'accepted')").all();
    expect(openOffers).toHaveLength(0);

    const offers = db.prepare('SELECT * FROM offers WHERE customer_id = ? ORDER BY rowid ASC').all('c_1') as any[];
    // Even though model proposed 50% on turn 0 and retry on later turns, the code ladder dictates 2000, 1625, 1250, then escalate
    expect(offers).toHaveLength(3);
    expect(offers[0].amount_cents).toBe(2000);
    expect(offers[1].amount_cents).toBe(1625);
    expect(offers[2].amount_cents).toBe(1250);
    expect(offers[0].status).toBe('superseded');
    expect(offers[1].status).toBe('superseded');
    expect(offers[2].status).toBe('superseded');
    expect(offers[1].amount_cents).toBeLessThanOrEqual(offers[0].amount_cents);
    expect(offers[2].amount_cents).toBeLessThanOrEqual(offers[1].amount_cents);
  });

  it('D1: when model proposes retry for usage-30% customer after an offer exists, validated offer does not exceed previous amount and reply omits lowest', async () => {
    activeStructuredOutputs = [
      { intent: 'propose', proposal: { action: 'partial_credit', discount_percent: 20, reasoning: 'start' } },
      { intent: 'negotiate', proposal: { action: 'retry', reasoning: 'model proposes full price retry' } }
    ];
    activeTexts = [
      "Your Starter renewal of $25.00 didn't go through. I can offer you $20.00.",
      "The lowest possible rate I can offer is $25.00."
    ];

    const db = getDb();
    db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', 'c_1');
    db.prepare('UPDATE customers SET usage_percent = 30 WHERE id = ?').run('c_1');
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('be_d1', 'c_1', 'renewal', 2500, 'failed');

    const reqStart = { json: async () => ({ customerId: 'c_1' }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
    await startPOST(reqStart);

    const firstOffer = db.prepare('SELECT * FROM offers WHERE customer_id = ? ORDER BY rowid DESC LIMIT 1').get('c_1') as any;
    expect(firstOffer.amount_cents).toBe(2000);

    const reqMsg1 = { json: async () => ({ customerId: 'c_1', text: "can you do better than $20" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
    await messagePOST(reqMsg1);

    const offers = db.prepare('SELECT * FROM offers WHERE customer_id = ? ORDER BY rowid ASC').all('c_1') as any[];
    expect(offers).toHaveLength(2);
    // Validated offer must not exceed previous amount
    expect(offers[1].amount_cents).toBeLessThanOrEqual(offers[0].amount_cents);
    expect(offers[1].amount_cents).toBe(1625);

    const agentMsgs = db.prepare("SELECT text FROM conversations WHERE customer_id = ? AND role = 'agent' AND text != '[SYSTEM_CLAIM]' ORDER BY rowid ASC").all('c_1') as any[];
    expect(agentMsgs).toHaveLength(2);
    expect(agentMsgs[1].text).not.toMatch(/lowest/i);
  });
});

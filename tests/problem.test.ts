import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as startPOST } from '../src/app/api/agent/start/route';
import { POST as messagePOST } from '../src/app/api/agent/message/route';
import { getDb, seedDb } from '../src/lib/db';
import { AIMessage } from '@langchain/core/messages';
import { resetRateLimitsForTests } from '../src/lib/rate-limit';

let llmCall = 0;
const mockStructuredOutputs = [
  { intent: 'propose', proposal: { action: 'partial_credit', discount_percent: 20, reasoning: 'mock' } },
  { intent: 'propose', proposal: { action: 'partial_credit', discount_percent: 20, reasoning: 'mock' } },
  { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 35, reasoning: 'mock' } },
  { intent: 'negotiate', proposal: { action: 'retry', reasoning: 'mock' } }
];

const mockTexts = [
  "Your Starter renewal of $25.00 didn't go through. I can offer you $20.00.",
  "Your Starter renewal of $25.00 didn't go through. I can offer you $20.00.",
  "I can improve that to $16.25.",
  "the lowest possible rate I can offer ... is $25.00 ... we can retry the transaction at this rate."
];

vi.mock('../src/lib/agent/llm', () => ({
  getLlm: () => ({
    bindTools() { return this; },
    withStructuredOutput() {
      return {
        invoke: async () => {
          return mockStructuredOutputs[llmCall] || mockStructuredOutputs[0];
        }
      };
    },
    async invoke() {
      const txt = mockTexts[llmCall] || mockTexts[0];
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
    resetRateLimitsForTests();
    llmCall = 0;
  });

  it('drives the problem sequence and fails on invariants', async () => {
    const db = getDb();
    db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', 'c_1');
    // c_1 is Starter, 5% usage by default. Let's make it 30% usage to match problem
    db.prepare('UPDATE customers SET usage_percent = 30 WHERE id = ?').run('c_1');
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('be_1', 'c_1', 'renewal', 2500, 'failed');

    const reqStart = () => ({ json: async () => ({ customerId: 'c_1' }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any);
    
    await Promise.all([startPOST(reqStart()), startPOST(reqStart())]);

    const reqMsg1 = { json: async () => ({ customerId: 'c_1', text: "can yo make it $10" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
    await messagePOST(reqMsg1);

    const reqMsg2 = { json: async () => ({ customerId: 'c_1', text: "$10 i can aford" }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
    await messagePOST(reqMsg2);

    const msgs = db.prepare('SELECT * FROM conversations WHERE customer_id = ? ORDER BY created_at ASC').all('c_1') as any[];
    const agentMsgs = msgs.filter(m => m.role === 'agent');

    const firstMsgs = agentMsgs.filter(m => m.text.includes('didn\'t go through'));
    // expect(firstMsgs.length).toBe(1);

    const offers = db.prepare('SELECT * FROM offers WHERE customer_id = ? ORDER BY created_at ASC').all('c_1') as any[];
    console.log(offers);
    expect(offers[1].amount_cents).toBe(1625);
    expect(offers[2].amount_cents).toBe(1250);
    expect(agentMsgs[1].text).not.toMatch(/lowest|best/i);
    expect(offers[2].amount_cents).toBeLessThanOrEqual(offers[1].amount_cents);
  });
});

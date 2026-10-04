import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDb, resetDb, seedDb } from '../src/lib/db';
import { graph } from '../src/lib/agent/graph';
import * as tools from '../src/lib/agent/tools';

vi.mock('../src/lib/agent/tools', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createOrderInternal: vi.fn().mockImplementation(async (offerId) => {
      const db = getDb();
      const mockOrderId = 'mock_order_' + Date.now();
      db.prepare('UPDATE offers SET paypal_order_id = ?, paypal_order_status = ? WHERE id = ?')
        .run(mockOrderId, 'payer_action_required', offerId);
      return mockOrderId;
    })
  };
});

// A dynamic mock for LLM to control its behavior in tests
let mockInvokeResponse: any = {};
let mockComposeResponse: string = 'Mocked reply';

vi.mock('@langchain/google-vertexai', () => ({
  ChatVertexAI: class {
    withStructuredOutput() { return this; }
    async invoke(args: any) { 
      const sysMsg = args[0].content;
      if (sysMsg.includes('Intent:')) {
        return new AIMessage(mockComposeResponse);
      }
      return mockInvokeResponse;
    }
  }
}));

describe('Graph Level Tests', () => {
  beforeEach(() => {
    resetDb();
    const db = getDb();
    db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', 'c_4');
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get('c_4') as any;
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('evt_c_4', 'c_4', 'renewal', customer.plan_price_cents, 'failed');
    
    mockInvokeResponse = { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 10, reasoning: 'mock' } };
    mockComposeResponse = 'Mocked reply';
  });

  it('runs the graph end-to-end and persists state', async () => {
    const db = getDb();
    const state = { customerId: 'c_4', billingEventId: 'evt_c_4', messages: [new HumanMessage("I want a discount")] };
    
    const result = await graph.invoke(state, { configurable: { modelId: 'mock' } });
    expect(result.intent).toBe('negotiate');
    
    const offer = db.prepare('SELECT * FROM offers WHERE customer_id = ?').get('c_4') as any;
    expect(offer).toBeDefined();
    expect(offer.amount_cents).toBe(4500); 
  });

  it('escalate reply: overrides LLM hallucination with the code template', async () => {
    mockInvokeResponse = { intent: 'escalate', proposal: { action: 'escalate', reasoning: 'escalating' } };
    mockComposeResponse = 'Let me transfer you to a human right now.'; // The hallucination
    
    const state = { customerId: 'c_4', billingEventId: 'evt_c_4', messages: [new HumanMessage("chargeback")] };
    const result = await graph.invoke(state, { configurable: { modelId: 'mock' } });
    
    const lastMsg = result.messages[result.messages.length - 1].content;
    expect(lastMsg).toBe('Your account has been flagged for our billing team, and a specialist will follow up with you by email shortly.');
  });

  it("first stored message is role agent, contains the failed amount and the offer amount, and no customer-role message exists before the customer types", async () => {
    // 1. Agent makes an offer PROACTIVELY
    mockInvokeResponse = { intent: 'negotiate', proposal: { action: 'partial_credit', final_amount_cents: 4000, discount_percent: 20, reasoning: 'mock' } };
    mockComposeResponse = 'I hallucinate strings';
    await graph.invoke({ customerId: 'c_4', billingEventId: 'evt_c_4', messages: [new HumanMessage("Start the conversation proactively. The customer's payment failed. Propose an appropriate retention offer based on their usage.")] }, { configurable: { modelId: 'mock' } });
    
    const db = getDb();
    const msgs = db.prepare('SELECT * FROM conversations WHERE customer_id = ? ORDER BY created_at ASC').all('c_4') as any[];
    expect(msgs.length).toBe(1);
    expect(msgs[0].role).toBe('agent');
    // First proactive message for usage<60: credit offer template
    expect(msgs[0].text).toContain('$50.00');  // original price
    expect(msgs[0].text).toContain('$40.00');  // discounted (20%)
    expect(msgs.filter((m: any) => m.role === 'user').length).toBe(0);
    
    const offer1 = db.prepare('SELECT * FROM offers WHERE customer_id = ? ORDER BY ROWID DESC LIMIT 1').get('c_4') as any;
    
    // 2. Customer accepts
    mockInvokeResponse = { intent: 'accept', proposal: { action: 'partial_credit', final_amount_cents: 4000, reasoning: 'mock' } };
    await graph.invoke({ customerId: 'c_4', billingEventId: 'evt_c_4', messages: [new HumanMessage("ok")] }, { configurable: { modelId: 'mock' } });
    
    const offer1Accepted = db.prepare('SELECT * FROM offers WHERE id = ?').get(offer1.id) as any;
    expect(offer1Accepted.status).toBe('accepted');
    expect(offer1Accepted.paypal_order_id).toBeDefined();
    const firstOrderId = offer1Accepted.paypal_order_id;

    // 3. Capture declines -> offer marked 'failed'
    db.prepare(`UPDATE offers SET status = 'failed' WHERE id = ?`).run(offer1.id);
    
    // 4. Customer asks again, agent creates new offer
    mockInvokeResponse = { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 20, reasoning: 'mock2' } };
    await graph.invoke({ customerId: 'c_4', billingEventId: 'evt_c_4', messages: [new HumanMessage("it failed, try again")] }, { configurable: { modelId: 'mock' } });
    
    const offer2 = db.prepare('SELECT * FROM offers WHERE customer_id = ? ORDER BY ROWID DESC LIMIT 1').get('c_4') as any;
    expect(offer2.id).not.toBe(offer1.id);
    expect(offer2.status).toBe('pending');
    
    // 5. Customer accepts new offer
    mockInvokeResponse = { intent: 'accept', proposal: { action: 'partial_credit', final_amount_cents: 4000, reasoning: 'mock' } };
    await graph.invoke({ customerId: 'c_4', billingEventId: 'evt_c_4', messages: [new HumanMessage("ok")] }, { configurable: { modelId: 'mock' } });
    
    const offer2Accepted = db.prepare('SELECT * FROM offers WHERE id = ?').get(offer2.id) as any;
    expect(offer2Accepted.status).toBe('accepted');
    expect(offer2Accepted.paypal_order_id).toBeDefined();
    
    const secondOrderId = offer2Accepted.paypal_order_id;
    expect(secondOrderId).not.toBe(firstOrderId);
  });

  it('expired offer re-offer creates NEW offer and NEW order', async () => {
    const db = getDb();
    
    let result = await graph.invoke({
      messages: [new HumanMessage('discount please')],
      customerId: 'c_4',
      billingEventId: 'evt_c_4',
      customerContext: null,
      activeOfferId: null,
      intent: null,
      decision: null
    }, { configurable: { modelId: 'mock-model' } });
    
    const offer1 = db.prepare(`SELECT * FROM offers WHERE customer_id = 'c_4' ORDER BY ROWID DESC LIMIT 1`).get() as any;
    
    // Accept
    mockInvokeResponse = { intent: 'accept', proposal: { action: 'partial_credit', final_amount_cents: 4000, reasoning: 'mock' } };
    result = await graph.invoke({
      messages: result.messages.concat([new HumanMessage('yes')]),
      customerId: 'c_4',
      billingEventId: 'evt_c_4',
      customerContext: null,
      activeOfferId: null,
      intent: null,
      decision: null
    }, { configurable: { modelId: 'mock-model' } });

    // Expire the offer
    db.prepare(`UPDATE offers SET expires_at = ? WHERE id = ?`).run(new Date(Date.now() - 10000).toISOString(), offer1.id);

    // Can I get the offer again?
    mockInvokeResponse = { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 20, reasoning: 'mock2' } };
    result = await graph.invoke({
      messages: result.messages.concat([new HumanMessage('Can I get the offer again?')]),
      customerId: 'c_4',
      billingEventId: 'evt_c_4',
      customerContext: null,
      activeOfferId: null,
      intent: null,
      decision: null
    }, { configurable: { modelId: 'mock-model' } });

    const offer2 = db.prepare(`SELECT * FROM offers WHERE customer_id = 'c_4' ORDER BY ROWID DESC LIMIT 1`).get() as any;
    expect(offer2.id).not.toBe(offer1.id);

    // Accept again
    mockInvokeResponse = { intent: 'accept', proposal: { action: 'partial_credit', final_amount_cents: 4000, reasoning: 'mock' } };
    result = await graph.invoke({
      messages: result.messages.concat([new HumanMessage('yes')]),
      customerId: 'c_4',
      billingEventId: 'evt_c_4',
      customerContext: null,
      activeOfferId: null,
      intent: null,
      decision: null
    }, { configurable: { modelId: 'mock-model' } });

    const updatedOffer2 = db.prepare(`SELECT * FROM offers WHERE id = ?`).get(offer2.id) as any;
    expect(updatedOffer2.status).toBe('accepted');
    expect(updatedOffer2.paypal_order_id).toBeDefined();
    expect(updatedOffer2.paypal_order_id).not.toBe(offer1.paypal_order_id);
  });

  it('Ladder: question does not raise cap, two pushbacks reach 50%, second event starts at 20%', async () => {
    const db = getDb();
    
    // First event
    db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', 'c_4');
    
    // Proactive offer (0 pushbacks -> max 20%, so 5000 * 0.8 = 4000)
    mockInvokeResponse = { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 50, reasoning: 'mock' } };
    let result = await graph.invoke({ customerId: 'c_4', billingEventId: 'evt_c_4', messages: [new HumanMessage("I need a discount")] }, { configurable: { modelId: 'mock' } });
    
    let offer = db.prepare('SELECT * FROM offers WHERE customer_id = ? ORDER BY ROWID DESC LIMIT 1').get('c_4') as any;
    expect(offer.amount_cents).toBe(4000); // Clamped to 20%
    
    // Question (intent = neutral)
    mockInvokeResponse = { intent: 'neutral', proposal: { action: 'retry', reasoning: 'mock' } };
    result = await graph.invoke({ customerId: 'c_4', billingEventId: 'evt_c_4', messages: result.messages.concat([new HumanMessage("what is this charge for?")]) }, { configurable: { modelId: 'mock' } });
    
    // First pushback (intent = negotiate). Question didn't raise cap, so pushbacks = 1 -> max 35%, so 5000 * 0.65 = 3250
    mockInvokeResponse = { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 50, reasoning: 'mock' } };
    result = await graph.invoke({ customerId: 'c_4', billingEventId: 'evt_c_4', messages: result.messages.concat([new HumanMessage("still too high")]) }, { configurable: { modelId: 'mock' } });
    
    offer = db.prepare('SELECT * FROM offers WHERE customer_id = ? ORDER BY ROWID DESC LIMIT 1').get('c_4') as any;
    expect(offer.amount_cents).toBe(3250); // Clamped to 35%

    // Second pushback (intent = negotiate). pushbacks = 2 -> max 50%, so 5000 * 0.5 = 2500
    mockInvokeResponse = { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 80, reasoning: 'mock' } };
    result = await graph.invoke({ customerId: 'c_4', billingEventId: 'evt_c_4', messages: result.messages.concat([new HumanMessage("more discount")]) }, { configurable: { modelId: 'mock' } });
    
    offer = db.prepare('SELECT * FROM offers WHERE customer_id = ? ORDER BY ROWID DESC LIMIT 1').get('c_4') as any;
    expect(offer.amount_cents).toBe(2500); // Clamped to 50%

    // Second billing event starts at 20%
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('evt_c_4_2', 'c_4', 'renewal', 5000, 'failed');
    mockInvokeResponse = { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 80, reasoning: 'mock' } };
    result = await graph.invoke({ customerId: 'c_4', billingEventId: 'evt_c_4_2', messages: [new HumanMessage("discount again")] }, { configurable: { modelId: 'mock' } });
    
    offer = db.prepare('SELECT * FROM offers WHERE customer_id = ? ORDER BY ROWID DESC LIMIT 1').get('c_4') as any;
    expect(offer.amount_cents).toBe(4000); // Clamped to 20% again
  });

});

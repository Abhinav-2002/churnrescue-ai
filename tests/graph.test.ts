import { AIMessage } from '@langchain/core/messages';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDb, seedDb } from '../src/lib/db';
import { graph } from '../src/lib/agent/graph';
import { HumanMessage } from '@langchain/core/messages';

vi.mock('@langchain/google-vertexai', () => ({
  ChatVertexAI: class {
    withStructuredOutput() {
      return this;
    }
    async invoke(args) { if (args[0].content.includes('Intent:')) return new AIMessage('Mocked reply');
      return { intent: 'negotiate', proposal: { action: 'partial_credit', discount_percent: 10, reasoning: 'mock' } };
    }
  }
}));

describe('Graph Level Test', () => {
  beforeEach(() => {
    const db = getDb();
    db.exec('DELETE FROM agent_actions; DELETE FROM conversations; DELETE FROM recoveries; DELETE FROM offers; DELETE FROM billing_events; DELETE FROM customers;');
    seedDb();
  });

  it('runs the graph end-to-end and persists state', async () => {
    const db = getDb();
    db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', 'c_4');
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get('c_4') as any;
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run('evt_c_4', 'c_4', 'renewal', customer.plan_price_cents, 'failed');
    
    const state = {
      customerId: 'c_4',
      billingEventId: 'evt_c_4',
      messages: [new HumanMessage("I want a discount")]
    };
    
    const result = await graph.invoke(state, { configurable: { modelId: 'mock' } });
    expect(result.intent).toBe('negotiate');
    expect(result.decision.action).toBe('partial_credit');
    
    const offer = db.prepare('SELECT * FROM offers WHERE customer_id = ?').get('c_4') as any;
    expect(offer).toBeDefined();
    expect(offer.amount_cents).toBe(4500); // 5000 * 90%
  });
});

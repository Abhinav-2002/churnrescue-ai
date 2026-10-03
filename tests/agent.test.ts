import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDb, seedDb } from '../src/lib/db';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

vi.mock('@langchain/google-vertexai', () => ({
  ChatVertexAI: class {
    bindTools() { return this; }
    withStructuredOutput() {
      return {
        invoke: async (messages: any[]) => {
          const content = messages.map(m => m.content).join(' ');
          if (content.includes('I accept')) {
            return { intent: 'accept', proposal: { action: 'retry', reasoning: 'Mock' } };
          }
          return {
            intent: 'negotiate',
            proposal: { action: 'partial_credit', discount_percent: 20, reasoning: 'Mock reason' }
          };
        }
      };
    }
    async invoke() {
      return new AIMessage('Mock agent response with $20.00');
    }
  }
}));

import { graph } from '../src/lib/agent/graph';

describe('Agent Graph Tests', () => {
  beforeEach(() => {
    process.env.SQLITE_PATH = ':memory:';
    getDb().exec('DELETE FROM agent_actions; DELETE FROM conversations; DELETE FROM recoveries; DELETE FROM offers; DELETE FROM billing_events; DELETE FROM customers;');
    seedDb();
  });

  it('runs the graph end-to-end with mocked LLM', async () => {
    const db = getDb();
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run(
      'evt_test', 'c_1', 'renewal', 2500, 'failed'
    );

    const state = {
      customerId: 'c_1',
      billingEventId: 'evt_test',
      messages: [new HumanMessage('I want a discount')]
    };

    const out = await graph.invoke(state, { configurable: { modelId: 'mock' } });
    
    expect(out.intent).toBe('negotiate');
    const offer = db.prepare('SELECT * FROM offers WHERE customer_id = ?').get('c_1') as any;
    expect(offer).toBeDefined();
    expect(offer.status).toBe('pending');
  });

  it('accept with no pending offer does nothing', async () => {
    const db = getDb();
    db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run(
      'evt_test', 'c_1', 'renewal', 2500, 'failed'
    );

    const state = {
      customerId: 'c_1',
      billingEventId: 'evt_test',
      messages: [new HumanMessage('I accept')]
    };

    const out = await graph.invoke(state, { configurable: { modelId: 'mock' } });
    expect(out.intent).toBe('accept');
    
    const offer = db.prepare('SELECT * FROM offers WHERE customer_id = ?').get('c_1') as any;
    expect(offer).toBeUndefined();
  });
});

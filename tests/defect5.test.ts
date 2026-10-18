import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST as messagePOST } from '../src/app/api/agent/message/route';
import { getDb, resetDb } from '../src/lib/db';
import * as llmModule from '../src/lib/agent/llm';

vi.mock('../src/lib/agent/llm', () => ({
  getLlm: vi.fn().mockReturnValue({
    bindTools() { return this; },
    withStructuredOutput: () => ({
      invoke: vi.fn().mockResolvedValue({
        intent: 'decline',
        proposal: { action: 'partial_credit', reasoning: 'test' }
      })
    }) as any,
    invoke: vi.fn().mockImplementation(async () => {
      const { AIMessage } = await import('@langchain/core/messages');
      return new AIMessage('I can do better.');
    })
  } as any)
}));

describe('Defect 5: Decline resets ladder step', () => {
  beforeEach(() => {
    resetDb();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('preserves ladder step after declining an offer', async () => {
    const db = getDb();
    
    db.prepare(`UPDATE customers SET status = 'at_risk' WHERE id = 'c_1'`).run();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 2500, 'failed')`).run();
    
    // Offer 0: previous offer at step 0
    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, ladder_step)
      VALUES ('off_0', 'c_1', 'be_1', 'partial_credit', 2000, 'superseded', 0)
    `).run();
    // Offer 1: customer was offered step 1, but declined it
    db.prepare(`
      INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, status, ladder_step)
      VALUES ('off_1', 'c_1', 'be_1', 'partial_credit', 1625, 'declined', 1)
    `).run();

    // Now customer messages to renegotiate
    vi.mocked(llmModule.getLlm).mockReturnValue({
      bindTools() { return this; },
      withStructuredOutput: () => ({
        invoke: vi.fn().mockResolvedValue({
          intent: 'negotiate',
          proposal: { action: 'partial_credit', reasoning: 'test' }
        })
      }) as any,
      invoke: vi.fn().mockImplementation(async () => {
        const { AIMessage } = await import('@langchain/core/messages');
        return new AIMessage('Here is our next offer.');
      })
    } as any);

    const req = { json: async () => ({ customerId: 'c_1', text: 'actually $10 is ok' }), headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }) } as any;
    await messagePOST(req); // Negotiate

    const offers = db.prepare('SELECT * FROM offers WHERE customer_id = ? ORDER BY rowid ASC').all('c_1') as any[];
    
    // The third offer is the new partial_credit offer after renegotiating.
    // Because the first offer was 'declined', if getPreviousLadderStep ignores declined/failed offers, ladder resets!
    // But it should progress to 2 (since it was at 1).
    expect(offers).toHaveLength(3);
    expect(offers[0].status).toBe('superseded');
    expect(offers[0].ladder_step).toBe(0);
    expect(offers[1].status).toBe('declined');
    expect(offers[1].ladder_step).toBe(1);
    expect(offers[2].ladder_step).toBe(2);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as messagePOST } from '../src/app/api/agent/message/route';
import { POST as startPOST } from '../src/app/api/agent/start/route';
import { getDb, seedDb } from '../src/lib/db';
import { AIMessage } from '@langchain/core/messages';

let llmCall = 0;
let overrideText = "";

let overrideIntent = 'negotiate';

vi.mock('../src/lib/agent/llm', () => ({
  getLlm: () => ({
    bindTools() { return this; },
    withStructuredOutput() {
      return {
        invoke: async () => {
          return { intent: overrideIntent, proposal: { reasoning: 'mock' } };
        }
      };
    },
    async invoke() {
      llmCall++;
      return new AIMessage(overrideText);
    }
  })
}));

describe('Reply Validator', () => {
  beforeEach(() => {
    process.env.SQLITE_PATH = ':memory:';
    getDb();
    seedDb();
    llmCall = 0;
    overrideText = "";
    overrideIntent = 'negotiate';
  });

  it('rejects "lowest rate" claim if ladder is not at cap', async () => {
    const db = getDb();
    db.prepare(`UPDATE customers SET status = 'at_risk' WHERE id = 'c_1'`).run();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_1', 'c_1', 'renewal', 2500, 'failed')`).run();

    // The agent is about to make the first offer ($20.00). Ladder step is 0.
    // The LLM maliciously claims it is the lowest rate, while getting the amounts correct.
    overrideText = "Your Starter renewal of $25.00 didn't go through. The lowest possible rate I can offer is $20.00.";

    // 1. Start (Ladder step 0)
    const reqStart = new Request('http://localhost/api/agent/start', { method: 'POST', body: JSON.stringify({ customerId: 'c_1' }) });
    let resStart = await startPOST(reqStart);
    let jsonStart = await resStart.json();

    // The validator should reject this and use the fallback template
    expect(jsonStart.reply).not.toContain('lowest possible rate');
    expect(jsonStart.reply).toContain('we can offer a new amount of $20.00');

    let offer0 = db.prepare(`SELECT ladder_step, amount_cents FROM offers WHERE customer_id = 'c_1' AND status = 'pending'`).get() as any;
    expect(offer0.ladder_step).toBe(0);
    expect(offer0.amount_cents).toBe(2000);

    // 2. Now user pushes back
    const reqMsg1 = new Request('http://localhost/api/agent/message', { method: 'POST', body: JSON.stringify({ customerId: 'c_1', text: 'too expensive' }) });

    // Ladder step is now 1. Offer is $16.25. LLM claims lowest again.
    overrideText = "I can improve that to $16.25, but this is the lowest I can go.";
    let resMsg1 = await messagePOST(reqMsg1);
    let jsonMsg1 = await resMsg1.json();

    // The validator should reject this again and use the pushback fallback template
    expect(jsonMsg1.reply).not.toContain('lowest I can go');
    expect(jsonMsg1.reply).toContain('I can improve that to $16.25');

    let offer1 = db.prepare(`SELECT ladder_step, amount_cents FROM offers WHERE customer_id = 'c_1' AND status = 'pending'`).get() as any;
    expect(offer1.ladder_step).toBe(1);
    expect(offer1.amount_cents).toBe(1625);

    // 3. User pushes back again
    const reqMsg2 = new Request('http://localhost/api/agent/message', { method: 'POST', body: JSON.stringify({ customerId: 'c_1', text: 'still too much' }) });

    // Ladder step is now 2 (MAX). Offer is $12.50. LLM claims lowest.
    overrideText = "I can improve that to $12.50, but this is truly the lowest possible rate I can offer.";
    let resMsg2 = await messagePOST(reqMsg2);
    let jsonMsg2 = await resMsg2.json();

    // The validator should ALLOW this because ladder step is at cap (2).
    expect(jsonMsg2.reply).toContain('truly the lowest possible rate I can offer');
    expect(jsonMsg2.reply).toContain('$12.50');

    let offer2 = db.prepare(`SELECT ladder_step, amount_cents FROM offers WHERE customer_id = 'c_1' AND status = 'pending'`).get() as any;
    expect(offer2.ladder_step).toBe(2);
    expect(offer2.amount_cents).toBe(1250);
  });

  it('downgrade: model invents wrong target/amount is caught by amount check, not "lowest" suppression', async () => {
    // Setup: Pro customer ($50), usage 10%, failed renewal
    // guardrails.ts validateProposal('downgrade', {plan_price_cents:5000, usage:10}):
    //   -> nextLowerPlan(5000) = Starter ($25)
    //   -> final_amount_cents = 2500, target_plan = 'Starter'
    // compose_message:
    //   required = 2500, allowed = [5000]
    //   lower_tier_available = !!nextLowerPlan(2500) = !!undefined = FALSE
    //   (Starter is the floor; nothing cheaper exists)
    // LLM invents "Basic for $10" -> $10 is unapproved AND $25 is missing -> ok=false
    // Fallback fires because ok=false (amount check), NOT because of "lowest" suppression
    const db = getDb();
    db.prepare(`UPDATE customers SET status = 'at_risk', plan_name = 'Pro', plan_price_cents = 5000, usage_percent = 10 WHERE id = 'c_1'`).run();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_down', 'c_1', 'renewal', 5000, 'failed')`).run();

    overrideIntent = 'downgrade';
    // LLM invents invalid target "Basic" and wrong amount "$10" — neither matches the authoritative Starter/$25
    overrideText = "Your Pro renewal didn't go through. I can downgrade you to Basic for $10.00, which is the lowest possible rate.";

    const reqStart = new Request('http://localhost/api/agent/start', { method: 'POST', body: JSON.stringify({ customerId: 'c_1' }) });
    let resStart = await startPOST(reqStart);
    let jsonStart = await resStart.json();

    // The fallback fires because checkMessageAmounts fails (unapproved $10, missing required $25)
    // The reply must describe the ACTUAL authoritative downgrade: Starter plan for $25
    expect(jsonStart.reply).not.toContain('Basic');
    expect(jsonStart.reply).not.toContain('$10.00');
    expect(jsonStart.reply).toContain('Starter');
    expect(jsonStart.reply).toContain('$25.00');
    // lower_tier_available = false for Starter (it's the floor), so the "lowest possible rate"
    // claim was NOT what triggered the fallback — it was the wrong amount.
    // The fallback template does NOT include "lowest possible rate" wording.
    expect(jsonStart.reply).not.toContain('lowest possible rate');

    const offer = db.prepare(`SELECT kind, amount_cents, target_plan, status FROM offers WHERE customer_id = 'c_1' AND status = 'pending'`).get() as any;
    expect(offer.kind).toBe('downgrade');
    expect(offer.amount_cents).toBe(2500); // Authoritative: Starter plan = $25
    expect(offer.target_plan).toBe('Starter');
    expect(offer.status).toBe('pending');
  });

  it('downgrade: "lowest possible rate" claim from model is ALLOWED when Starter is genuinely the floor', async () => {
    // Same Pro setup. LLM correctly states Starter/$25 AND claims "lowest possible rate".
    // lower_tier_available = !!nextLowerPlan(2500) = false (Starter is the floor)
    // checkMessageAmounts: $25 present (required), $50 present (allowed) -> ok=true
    // "lowest" suppression: ok=true AND lower_tier_available=false -> suppression does NOT fire
    // -> model text passes through unchanged
    const db = getDb();
    db.prepare(`UPDATE customers SET status = 'at_risk', plan_name = 'Pro', plan_price_cents = 5000, usage_percent = 10 WHERE id = 'c_1'`).run();
    db.prepare(`INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES ('be_down2', 'c_1', 'renewal', 5000, 'failed')`).run();

    overrideIntent = 'downgrade';
    // LLM correctly states both plan price AND downgrade amount, and claims "lowest rate"
    overrideText = "Your Pro renewal of $50.00 didn't go through. We can move you to the Starter plan for $25.00, which is the lowest possible rate. Would you like to proceed?";

    const reqStart = new Request('http://localhost/api/agent/start', { method: 'POST', body: JSON.stringify({ customerId: 'c_1' }) });
    let resStart = await startPOST(reqStart);
    let jsonStart = await resStart.json();

    // Model text passes: amounts are correct, and "lowest" is truthful (Starter IS the floor)
    expect(jsonStart.reply).toContain('$25.00');
    expect(jsonStart.reply).toContain('Starter');
    expect(jsonStart.reply).toContain('lowest possible rate');

    const offer = db.prepare(`SELECT kind, amount_cents, target_plan, status FROM offers WHERE customer_id = 'c_1' AND status = 'pending'`).get() as any;
    expect(offer.kind).toBe('downgrade');
    expect(offer.amount_cents).toBe(2500);
    expect(offer.target_plan).toBe('Starter');
    expect(offer.status).toBe('pending');
  });
});

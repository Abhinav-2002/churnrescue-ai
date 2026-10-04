const fs = require('fs');
let code = fs.readFileSync('tests/guardrails.test.ts', 'utf8');

const tests = `
  it('concession ladder clamps discounts based on pushbacks', () => {
    const ctx = { plan_name: 'Pro', plan_price_cents: 5000, usage_percent: 10 };
    const proposal = { action: 'partial_credit', discount_percent: 50, reasoning: 'test' };
    
    // 0 pushbacks -> 20% max
    let res = validateProposal(proposal, ctx, { pushbacks: 0 });
    expect(res.discount_percent).toBe(20);
    
    // 1 pushback -> 35% max
    res = validateProposal(proposal, ctx, { pushbacks: 1 });
    expect(res.discount_percent).toBe(35);
    
    // 2 pushbacks -> 50% max
    res = validateProposal(proposal, ctx, { pushbacks: 2 });
    expect(res.discount_percent).toBe(50);
  });

  it('cancel intent handles logic correctly', () => {
    const ctxLow = { plan_name: 'Pro', plan_price_cents: 5000, usage_percent: 10 };
    const ctxHigh = { plan_name: 'Pro', plan_price_cents: 5000, usage_percent: 90 };
    const proposal = { action: 'retry', reasoning: 'test' };

    // usage < 60 -> pause
    let res = validateProposal(proposal, ctxLow, { intent: 'cancel' });
    expect(res.action).toBe('pause');

    // usage >= 60, cancelCount 0 -> retry
    res = validateProposal(proposal, ctxHigh, { intent: 'cancel', cancelCount: 0 });
    expect(res.action).toBe('retry');

    // usage >= 60, cancelCount 1 -> escalate
    res = validateProposal(proposal, ctxHigh, { intent: 'cancel', cancelCount: 1 });
    expect(res.action).toBe('escalate');
  });

  it('decline intent handles logic correctly', () => {
    const ctxLow = { plan_name: 'Pro', plan_price_cents: 5000, usage_percent: 10 };
    const ctxHigh = { plan_name: 'Pro', plan_price_cents: 5000, usage_percent: 90 };
    const proposal = { action: 'retry', reasoning: 'test' };

    let res = validateProposal(proposal, ctxLow, { intent: 'decline' });
    expect(res.action).toBe('pause');

    res = validateProposal(proposal, ctxHigh, { intent: 'decline' });
    expect(res.action).toBe('retry');
  });
`;

code = code.replace(/}\);\s*$/, tests + '\n});\n');
fs.writeFileSync('tests/guardrails.test.ts', code);

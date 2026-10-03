import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  const db = getDb();

  // 1. Summary
  const summaryRow = db.prepare(`
    SELECT 
      COALESCE((SELECT SUM(amount_cents) FROM billing_events WHERE status = 'failed'), 0) as totalFailedAmount,
      COALESCE((SELECT SUM(recovered_amount_cents) FROM recoveries), 0) as totalRecoveredAmount,
      (SELECT COUNT(*) FROM customers WHERE status IN ('at_risk', 'paused')) as atRiskOrPausedCount
  `).get() as any;

  const totalFailedAmount = summaryRow.totalFailedAmount;
  const totalRecoveredAmount = summaryRow.totalRecoveredAmount;
  const recoveryRate = totalFailedAmount > 0 ? (totalRecoveredAmount / totalFailedAmount) : 0;

  const summary = {
    totalFailedAmount,
    totalRecoveredAmount,
    recoveryRate,
    atRiskOrPausedCount: summaryRow.atRiskOrPausedCount,
  };

  // 2. Customers Grid
  const customers = db.prepare(`
    SELECT 
      c.id, 
      c.name, 
      c.plan_name as plan, 
      c.usage_percent as usagePercent, 
      c.status,
      COALESCE((SELECT SUM(amount_cents) FROM billing_events WHERE customer_id = c.id AND status = 'failed'), 0) as failedAmount,
      COALESCE((SELECT SUM(amount_cents) FROM offers WHERE customer_id = c.id), 0) as offeredAmount,
      COALESCE((SELECT SUM(recovered_amount_cents) FROM recoveries WHERE customer_id = c.id), 0) as recoveredAmount,
      (SELECT action FROM agent_actions WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1) as lastAgentAction
    FROM customers c
  `).all();

  // 3. Actions Grid
  const actions = db.prepare(`
    SELECT
      a.id,
      a.created_at as timestamp,
      c.name as customer,
      a.action,
      a.reasoning,
      a.details_json
    FROM agent_actions a
    JOIN customers c ON a.customer_id = c.id
    ORDER BY a.created_at DESC
  `).all().map((a: any) => {
    let clampsApplied: string[] = [];
    try {
      const details = JSON.parse(a.details_json);
      clampsApplied = details.clamps || [];
    } catch(e) {}
    
    return {
      id: a.id,
      timestamp: a.timestamp,
      customer: a.customer,
      action: a.action,
      reasoning: a.reasoning,
      clampsApplied
    };
  });

  return NextResponse.json({
    summary,
    customers,
    actions
  });
}

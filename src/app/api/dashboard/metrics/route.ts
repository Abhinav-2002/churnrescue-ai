export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import crypto from 'crypto';
import { rateLimit, LIMITS } from '@/lib/rate-limit';
import { nextLowerPlan } from '@/lib/plans';

// Pure guardrail policy constants matching src/lib/agent/guardrails.ts
const MIN_CHARGE_CENTS = 100;
const PARTIAL_CREDIT_MAX_USAGE_EXCLUSIVE = 60;
const MAX_DISCOUNT_PERCENT = 50;
const LADDER_PERCENTS = [20, 35, 50];

// Response Zod Schema
const responseSchema = z.object({
  range_days: z.number(),
  range_totals: z.object({
    current: z.object({
      recovered_revenue_cents: z.number(),
      recovery_rate: z.number(),
      failed_amount_cents: z.number(),
      customers_recovered: z.number(),
      needs_human: z.number()
    }),
    previous: z.object({
      recovered_revenue_cents: z.number(),
      recovery_rate: z.number(),
      failed_amount_cents: z.number(),
      customers_recovered: z.number(),
      needs_human: z.number(),
      failed_events_count: z.number()
    }),
    deltas: z.object({
      recovered_revenue_percent: z.number().nullable(),
      recovery_rate_points: z.number().nullable(),
      failed_amount_percent: z.number().nullable(),
      customers_recovered_percent: z.number().nullable(),
      needs_human_count: z.number().nullable()
    })
  }),
  kpis: z.object({
    total_failed: z.number(),
    total_recovered: z.number(),
    recovery_rate: z.number(),
    at_risk: z.number(),
    paused: z.number(),
    escalated: z.number(),
    average_discount: z.number(),
    median_hours_to_recovery: z.number()
  }),
  daily_series: z.array(z.object({
    date: z.string(),
    failed_amount_cents: z.number(),
    recovered_amount_cents: z.number()
  })),
  sparklines: z.object({
    recovered_revenue: z.array(z.number()),
    recovery_rate: z.array(z.number()),
    failed_amount: z.array(z.number()),
    customers_recovered: z.array(z.number()),
    needs_human: z.array(z.number())
  }),
  intervention_mix: z.object({
    total_interventions: z.number(),
    retry: z.number(),
    credit: z.number(),
    downgrade: z.number(),
    pause: z.number(),
    escalate: z.number()
  }),
  funnel: z.object({
    failed: z.number(),
    offered: z.number(),
    accepted: z.number(),
    paid: z.number()
  }),
  guardrail_summary: z.object({
    pricing_adjustments: z.number(),
    blocked_suggestions: z.number(),
    escalated_by_keyword: z.number(),
    template_enforced: z.number(),
    total_checks: z.number(),
    latest_clamp_summary: z.string().nullable()
  }),
  policy_audit: z.object({
    total_audited: z.number(),
    outside_policy_count: z.number(),
    violating_offer_ids: z.array(z.string())
  }),
  human_queue: z.array(z.object({
    customer_id: z.string(),
    name: z.string(),
    reason_category: z.string(),
    severity: z.enum(['High', 'Medium', 'Low']),
    failed_amount_cents: z.number(),
    created_at: z.string()
  })),
  customers: z.array(z.object({
    id: z.string(),
    name: z.string(),
    plan: z.string(),
    price_cents: z.number(),
    usage_percent: z.number(),
    status: z.string(),
    last_action: z.string().nullable(),
    last_action_at: z.string().nullable(),
    failed_amount_cents: z.number(),
    recovered_amount_cents: z.number(),
    intervention: z.string().nullable(),
    updated_at: z.string()
  })),
  offers: z.array(z.object({
    id: z.string(),
    customer_id: z.string(),
    kind: z.string(),
    discount_percent: z.number().nullable(),
    ladder_step: z.number().nullable(),
    amount_cents: z.number(),
    status: z.string(),
    created_at: z.string()
  })),
  recoveries: z.array(z.object({
    customer_id: z.string(),
    original_amount_cents: z.number(),
    recovered_amount_cents: z.number(),
    created_at: z.string()
  })),
  decisions: z.array(z.object({
    created_at: z.string(),
    customer_id: z.string(),
    action: z.string(),
    proposed_discount_percent: z.number().nullable(),
    approved_discount_percent: z.number().nullable(),
    guardrail_category: z.string().nullable(),
    ladder_step: z.number().nullable()
  }))
});

function getGuardrailCategory(details: any): string | null {
  const c = details?.clamps || [];
  const s = Array.isArray(c) ? c.join(' ') : (c || '');
  if (s.includes('escalate') || s.includes('cancel intent >= 60 usage twice')) return 'escalated_by_keyword';
  if (s.includes('intent') || s.includes('invalid') || s.includes('not allowed')) return 'retry_forced';
  
  if (details.proposed_discount_percent != null && details.approved_discount_percent != null) {
    if (details.proposed_discount_percent > details.approved_discount_percent) {
      return 'ladder_limited';
    }
  }
  
  if (details.template_used) return 'template_used';
  return null;
}

export function classifyEscalationReason(clamps: string[]): { reason: string; severity: 'High' | 'Medium' | 'Low' } {
  const str = clamps.join(' ').toLowerCase();
  if (str.includes('dispute')) return { reason: 'dispute', severity: 'High' };
  if (str.includes('chargeback')) return { reason: 'chargeback', severity: 'High' };
  if (str.includes('legal')) return { reason: 'legal', severity: 'High' };
  if (str.includes('fraud')) return { reason: 'fraud', severity: 'High' };
  if (str.includes('human')) return { reason: 'human_requested', severity: 'Medium' };
  if (str.includes('anger')) return { reason: 'frustration', severity: 'Medium' };
  if (str.includes('cancel intent >= 60 usage twice')) return { reason: 'repeat_cancel', severity: 'Low' };
  return { reason: 'general_escalation', severity: 'Medium' };
}

export function auditOffer(offer: {
  id: string;
  kind: string;
  amount_cents: number;
  discount_percent: number | null;
  ladder_step: number | null;
  target_plan: string | null;
  plan_price_cents: number;
  usage_percent: number;
}): boolean {
  // Pure policy audit function
  // 1. Floor check: floor 100 cents except pause (which must be 0)
  if (offer.kind === 'pause') {
    if (offer.amount_cents !== 0) return false;
  } else {
    if (offer.amount_cents < MIN_CHARGE_CENTS) return false;
  }

  // 2. Partial credit rules
  if (offer.kind === 'partial_credit') {
    if (offer.usage_percent >= PARTIAL_CREDIT_MAX_USAGE_EXCLUSIVE) return false;
    if (offer.discount_percent == null || offer.discount_percent <= 0 || offer.discount_percent > MAX_DISCOUNT_PERCENT) return false;
    
    // Check ladder cap if ladder_step provided
    const step = offer.ladder_step ?? 0;
    const maxAllowed = LADDER_PERCENTS[step] ?? MAX_DISCOUNT_PERCENT;
    if (offer.discount_percent > maxAllowed) return false;

    // Amount arithmetic check
    const expected = Math.round((offer.plan_price_cents * (100 - offer.discount_percent)) / 100);
    if (offer.amount_cents !== expected) return false;
  }

  // 3. Downgrade check
  if (offer.kind === 'downgrade') {
    const lower = nextLowerPlan(offer.plan_price_cents);
    if (!lower) return false;
    if (offer.target_plan !== lower.name) return false;
    if (offer.amount_cents !== lower.priceCents) return false;
  }

  // 4. Retry check
  if (offer.kind === 'retry') {
    if (offer.amount_cents !== offer.plan_price_cents) return false;
  }

  return true;
}

export async function GET(req: Request) {
  const limited = rateLimit(req, LIMITS.dashboardMetrics);
  if (limited) return limited;

  try {
    const url = new URL(req.url);
    const daysParam = url.searchParams.get('days');
    let days = 14;

    if (daysParam !== null) {
      if (daysParam !== '7' && daysParam !== '14' && daysParam !== '30') {
        return NextResponse.json({ error: 'invalid_query' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
      }
      days = parseInt(daysParam, 10);
    }

    const db = getDb();

    // Timestamp windows for current and previous equal-length periods
    const nowMs = Date.now();
    const currStartMs = nowMs - days * 86400 * 1000;
    const prevStartMs = nowMs - 2 * days * 86400 * 1000;
    const currStartIso = new Date(currStartMs).toISOString();
    const prevStartIso = new Date(prevStartMs).toISOString();

    // 1. Customers (Capped at 200)
    const customersRaw = db.prepare(`
      SELECT 
        c.id, c.name, c.plan_name as plan, c.plan_price_cents as price_cents, 
        c.usage_percent, c.status, c.created_at,
        (SELECT action FROM agent_actions WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1) as last_action,
        (SELECT created_at FROM agent_actions WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1) as last_action_at,
        COALESCE((SELECT SUM(amount_cents) FROM billing_events WHERE customer_id = c.id AND status IN ('failed', 'recovered')), 0) as failed_amount_cents,
        COALESCE((SELECT SUM(recovered_amount_cents) FROM recoveries WHERE customer_id = c.id), 0) as recovered_amount_cents
      FROM customers c
      LIMIT 200
    `).all() as any[];

    const customers = customersRaw.map(c => ({
      id: c.id,
      name: c.name,
      plan: c.plan,
      price_cents: c.price_cents,
      usage_percent: c.usage_percent,
      status: c.status,
      last_action: c.last_action,
      last_action_at: c.last_action_at,
      failed_amount_cents: c.failed_amount_cents,
      recovered_amount_cents: c.recovered_amount_cents,
      intervention: c.last_action === 'partial_credit' ? 'Discount' : (c.last_action ? c.last_action.replace('_', ' ') : null),
      updated_at: c.last_action_at || c.created_at || new Date().toISOString()
    }));

    // 2. Offers (Capped at 200)
    const offers = db.prepare(`
      SELECT id, customer_id, kind, discount_percent, ladder_step, amount_cents, status, created_at, target_plan
      FROM offers
      ORDER BY created_at DESC
      LIMIT 200
    `).all() as any[];

    // 3. Recoveries (Capped at 200)
    const recoveries = db.prepare(`
      SELECT customer_id, original_amount_cents, recovered_amount_cents, created_at
      FROM recoveries
      ORDER BY created_at DESC
      LIMIT 200
    `).all() as any[];

    // 4. Decisions (Capped at 100)
    const agentActions = db.prepare(`
      SELECT created_at, customer_id, action, details_json
      FROM agent_actions
      ORDER BY created_at DESC
      LIMIT 100
    `).all() as any[];

    let latestClampedExample: string | null = null;
    const decisions = agentActions.map(a => {
      let details: any = {};
      try { details = JSON.parse(a.details_json); } catch(e) {}

      if (!latestClampedExample && details.proposed_discount_percent != null && details.approved_discount_percent != null) {
        if (details.proposed_discount_percent > details.approved_discount_percent) {
          latestClampedExample = `Model proposed ${details.proposed_discount_percent}%, code allowed ${details.approved_discount_percent}%`;
        }
      }

      return {
        created_at: a.created_at,
        customer_id: a.customer_id,
        action: a.action,
        proposed_discount_percent: details.proposed_discount_percent ?? null,
        approved_discount_percent: details.approved_discount_percent ?? null,
        guardrail_category: getGuardrailCategory(details),
        ladder_step: details.ladder_step ?? null
      };
    });

    // 5. Daily Series (UTC)
    const seriesFailed = db.prepare(`
      SELECT DATE(created_at) as date, SUM(amount_cents) as total
      FROM billing_events
      WHERE status IN ('failed', 'recovered')
      GROUP BY DATE(created_at)
    `).all() as any[];

    const seriesRecovered = db.prepare(`
      SELECT DATE(created_at) as date, SUM(recovered_amount_cents) as total
      FROM recoveries
      GROUP BY DATE(created_at)
    `).all() as any[];

    const allDates = new Set([...seriesFailed.map(s => s.date), ...seriesRecovered.map(s => s.date)]);
    const daily_series = Array.from(allDates).sort().map(date => {
      const f = seriesFailed.find(s => s.date === date);
      const r = seriesRecovered.find(s => s.date === date);
      return {
        date,
        failed_amount_cents: f ? f.total : 0,
        recovered_amount_cents: r ? r.total : 0
      };
    });

    // 6. Sparklines (Daily arrays for 5 KPIs)
    const sparklineDays = days;
    const sparklineDates: string[] = [];
    for (let i = sparklineDays - 1; i >= 0; i--) {
      sparklineDates.push(new Date(nowMs - i * 86400 * 1000).toISOString().slice(0, 10));
    }

    const sparklines = {
      recovered_revenue: sparklineDates.map(d => {
        const found = seriesRecovered.find(s => s.date === d);
        return found ? found.total : 0;
      }),
      recovery_rate: sparklineDates.map(d => {
        const f = seriesFailed.find(s => s.date === d)?.total || 0;
        const r = seriesRecovered.find(s => s.date === d)?.total || 0;
        return f > 0 ? Math.min(1, r / f) : 0;
      }),
      failed_amount: sparklineDates.map(d => {
        const found = seriesFailed.find(s => s.date === d);
        return found ? found.total : 0;
      }),
      customers_recovered: sparklineDates.map(d => {
        const row = db.prepare(`SELECT COUNT(DISTINCT customer_id) as c FROM recoveries WHERE DATE(created_at) = ?`).get(d) as any;
        return row ? row.c : 0;
      }),
      needs_human: sparklineDates.map(d => {
        const row = db.prepare(`SELECT COUNT(*) as c FROM agent_actions WHERE action = 'escalate' AND DATE(created_at) = ?`).get(d) as any;
        return row ? row.c : 0;
      })
    };

    // 7. Funnel (with strict monotonic non-increasing property: failed >= offered >= accepted >= paid)
    const totalFailedRaw = (db.prepare(`SELECT COUNT(*) as c FROM billing_events
      WHERE status IN ('failed', 'recovered')`).get() as any).c;
    const totalPaidRaw = (db.prepare(`SELECT COUNT(*) as c FROM recoveries`).get() as any).c;
    const totalAcceptedRaw = Math.max(
      (db.prepare(`SELECT COUNT(*) as c FROM offers WHERE status = 'accepted'`).get() as any).c,
      totalPaidRaw
    );
    const totalOfferedRaw = Math.max(
      (db.prepare(`SELECT COUNT(*) as c FROM offers WHERE status != 'superseded'`).get() as any).c,
      totalAcceptedRaw
    );
    const funnelFailed = totalFailedRaw;
    const funnelOffered = totalOfferedRaw;
    const funnelAccepted = totalAcceptedRaw;
    const funnelPaid = totalPaidRaw;

    // 8. Range Totals & Previous-Period Calculations
    const currFailedRow = db.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) as total, COUNT(*) as count
      FROM billing_events
      WHERE status IN ('failed', 'recovered') AND created_at >= ?
    `).get(currStartIso) as any;
    
    const currRecoveredRow = db.prepare(`
      SELECT COALESCE(SUM(recovered_amount_cents), 0) as total, COUNT(DISTINCT customer_id) as customers_count
      FROM recoveries
      WHERE created_at >= ?
    `).get(currStartIso) as any;

    const prevFailedRow = db.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) as total, COUNT(*) as count
      FROM billing_events
      WHERE status IN ('failed', 'recovered') AND created_at >= ? AND created_at < ?
    `).get(prevStartIso, currStartIso) as any;

    const prevRecoveredRow = db.prepare(`
      SELECT COALESCE(SUM(recovered_amount_cents), 0) as total, COUNT(DISTINCT customer_id) as customers_count
      FROM recoveries
      WHERE created_at >= ? AND created_at < ?
    `).get(prevStartIso, currStartIso) as any;

    const currNeedsHuman = (db.prepare(`
      SELECT COUNT(DISTINCT customer_id) as c FROM agent_actions WHERE action = 'escalate' AND created_at >= ?
    `).get(currStartIso) as any).c;

    const prevNeedsHuman = (db.prepare(`
      SELECT COUNT(DISTINCT customer_id) as c FROM agent_actions WHERE action = 'escalate' AND created_at >= ? AND created_at < ?
    `).get(prevStartIso, currStartIso) as any).c;

    const currRecoveredRevenue = currRecoveredRow.total;
    const currFailedAmount = currFailedRow.total;
    const currRecoveryRate = currFailedAmount > 0 ? (currRecoveredRevenue / currFailedAmount) : 0;
    const currCustomersRecovered = currRecoveredRow.customers_count;

    const prevRecoveredRevenue = prevRecoveredRow.total;
    const prevFailedAmount = prevFailedRow.total;
    const prevRecoveryRate = prevFailedAmount > 0 ? (prevRecoveredRevenue / prevFailedAmount) : 0;
    const prevCustomersRecovered = prevRecoveredRow.customers_count;
    const prevFailedEventsCount = prevFailedRow.count;

    // Delta Rule: ONLY compute delta when previous period has >= 3 failed events; otherwise null
    const hasPriorData = prevFailedEventsCount >= 3;
    const deltas = {
      recovered_revenue_percent: hasPriorData 
        ? (prevRecoveredRevenue > 0 ? Math.round(((currRecoveredRevenue - prevRecoveredRevenue) / prevRecoveredRevenue) * 100) : (currRecoveredRevenue > 0 ? 100 : 0))
        : null,
      recovery_rate_points: hasPriorData 
        ? Math.round((currRecoveryRate - prevRecoveryRate) * 100)
        : null,
      failed_amount_percent: hasPriorData 
        ? (prevFailedAmount > 0 ? Math.round(((currFailedAmount - prevFailedAmount) / prevFailedAmount) * 100) : (currFailedAmount > 0 ? 100 : 0))
        : null,
      customers_recovered_percent: hasPriorData 
        ? (prevCustomersRecovered > 0 ? Math.round(((currCustomersRecovered - prevCustomersRecovered) / prevCustomersRecovered) * 100) : (currCustomersRecovered > 0 ? 100 : 0))
        : null,
      needs_human_count: hasPriorData 
        ? (currNeedsHuman - prevNeedsHuman)
        : null
    };

    // 9. Intervention Mix (Each customer's LATEST decision)
    const latestDecisions = db.prepare(`
      SELECT a.customer_id, a.action
      FROM agent_actions a
      INNER JOIN (
        SELECT customer_id, MAX(created_at) as max_created
        FROM agent_actions
        GROUP BY customer_id
      ) latest ON a.customer_id = latest.customer_id AND a.created_at = latest.max_created
    `).all() as { customer_id: string; action: string }[];

    let retryCount = 0;
    let creditCount = 0;
    let downgradeCount = 0;
    let pauseCount = 0;
    let escalateCount = 0;

    for (const d of latestDecisions) {
      if (d.action === 'retry') retryCount++;
      else if (d.action === 'partial_credit') creditCount++;
      else if (d.action === 'downgrade') downgradeCount++;
      else if (d.action === 'pause') pauseCount++;
      else if (d.action === 'escalate') escalateCount++;
    }

    const totalInterventions = retryCount + creditCount + downgradeCount + pauseCount + escalateCount;

    // 10. Guardrail Summary
    let pricingAdjustments = 0;
    let blockedSuggestions = 0;
    let escalatedByKeyword = 0;
    let templateEnforced = 0;

    for (const a of agentActions) {
      let details: any = {};
      try { details = JSON.parse(a.details_json); } catch(e) {}
      const cat = getGuardrailCategory(details);
      if (cat === 'ladder_limited') pricingAdjustments++;
      else if (cat === 'retry_forced') blockedSuggestions++;
      else if (cat === 'escalated_by_keyword') escalatedByKeyword++;
      else if (cat === 'template_used') templateEnforced++;
    }

    // 11. Policy Audit (Re-evaluates every stored non-superseded offer)
    const auditOffers = db.prepare(`
      SELECT o.id, o.kind, o.amount_cents, o.discount_percent, o.ladder_step, o.target_plan,
             c.plan_price_cents, c.usage_percent
      FROM offers o
      JOIN customers c ON o.customer_id = c.id
      WHERE o.status != 'superseded'
    `).all() as any[];

    const violatingOfferIds: string[] = [];
    for (const o of auditOffers) {
      const valid = auditOffer(o);
      if (!valid) {
        violatingOfferIds.push(o.id);
      }
    }

    // 12. Needs a Human Queue (Capped at 50, sorted by severity then recency)
    const humanRowsRaw = db.prepare(`
      SELECT 
        c.id as customer_id, c.name,
        a.created_at, a.details_json,
        COALESCE(b.amount_cents, c.plan_price_cents) as failed_amount_cents
      FROM customers c
      JOIN agent_actions a ON a.customer_id = c.id
      LEFT JOIN billing_events b ON a.billing_event_id = b.id
      WHERE a.action = 'escalate'
      ORDER BY a.created_at DESC
      LIMIT 100
    `).all() as any[];

    const humanQueueSeen = new Set<string>();
    const humanQueue = humanRowsRaw
      .filter(r => {
        if (humanQueueSeen.has(r.customer_id)) return false;
        humanQueueSeen.add(r.customer_id);
        return true;
      })
      .map(r => {
        let details: any = {};
        try { details = JSON.parse(r.details_json); } catch(e) {}
        const clamps: string[] = Array.isArray(details.clamps) ? details.clamps : [];
        const { reason, severity } = classifyEscalationReason(clamps);
        return {
          customer_id: r.customer_id,
          name: r.name,
          reason_category: reason,
          severity,
          failed_amount_cents: r.failed_amount_cents,
          created_at: r.created_at
        };
      })
      .sort((a, b) => {
        const rank = { High: 0, Medium: 1, Low: 2 };
        if (rank[a.severity] !== rank[b.severity]) {
          return rank[a.severity] - rank[b.severity];
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      })
      .slice(0, 50);

    // 13. KPIs (retained for backward compatibility)
    const atRisk = customersRaw.filter(c => c.status === 'at_risk').length;
    const paused = customersRaw.filter(c => c.status === 'paused').length;
    const escalated = customersRaw.filter(c => c.last_action === 'escalate').length;

    const discountOffers = offers.filter(o => o.status !== 'superseded' && o.discount_percent != null && o.discount_percent > 0);
    const averageDiscount = discountOffers.length > 0 
      ? discountOffers.reduce((sum, o) => sum + o.discount_percent, 0) / discountOffers.length
      : 0;

    const hoursRows = db.prepare(`
      SELECT (julianday(r.created_at) - julianday(b.created_at)) * 24 as hours
      FROM recoveries r
      JOIN billing_events b ON r.billing_event_id = b.id
    `).all() as { hours: number }[];
    
    let medianHours = 0;
    if (hoursRows.length > 0) {
      hoursRows.sort((a, b) => a.hours - b.hours);
      const half = Math.floor(hoursRows.length / 2);
      if (hoursRows.length % 2 === 0) {
        medianHours = (hoursRows[half - 1].hours + hoursRows[half].hours) / 2.0;
      } else {
        medianHours = hoursRows[half].hours;
      }
    }

    const payload = responseSchema.parse({
      range_days: days,
      range_totals: {
        current: {
          recovered_revenue_cents: currRecoveredRevenue,
          recovery_rate: currRecoveryRate,
          failed_amount_cents: currFailedAmount,
          customers_recovered: currCustomersRecovered,
          needs_human: currNeedsHuman
        },
        previous: {
          recovered_revenue_cents: prevRecoveredRevenue,
          recovery_rate: prevRecoveryRate,
          failed_amount_cents: prevFailedAmount,
          customers_recovered: prevCustomersRecovered,
          needs_human: prevNeedsHuman,
          failed_events_count: prevFailedEventsCount
        },
        deltas
      },
      kpis: {
        total_failed: totalFailedRaw,
        total_recovered: totalPaidRaw,
        recovery_rate: totalFailedRaw > 0 ? (totalPaidRaw / totalFailedRaw) : 0,
        at_risk: atRisk,
        paused: paused,
        escalated: escalated,
        average_discount: averageDiscount,
        median_hours_to_recovery: medianHours
      },
      daily_series,
      sparklines,
      intervention_mix: {
        total_interventions: totalInterventions,
        retry: retryCount,
        credit: creditCount,
        downgrade: downgradeCount,
        pause: pauseCount,
        escalate: escalateCount
      },
      funnel: {
        failed: funnelFailed,
        offered: funnelOffered,
        accepted: funnelAccepted,
        paid: funnelPaid
      },
      guardrail_summary: {
        pricing_adjustments: pricingAdjustments,
        blocked_suggestions: blockedSuggestions,
        escalated_by_keyword: escalatedByKeyword,
        template_enforced: templateEnforced,
        total_checks: agentActions.length,
        latest_clamp_summary: latestClampedExample
      },
      policy_audit: {
        total_audited: auditOffers.length,
        outside_policy_count: violatingOfferIds.length,
        violating_offer_ids: violatingOfferIds
      },
      human_queue: humanQueue,
      customers,
      offers,
      recoveries,
      decisions
    });

    const jsonStr = JSON.stringify(payload);
    const etag = crypto.createHash('md5').update(jsonStr).digest('hex');

    const reqEtag = req.headers.get('if-none-match');
    if (reqEtag === etag) {
      return new NextResponse(null, { status: 304, headers: { 'Cache-Control': 'no-store' } });
    }

    return new NextResponse(jsonStr, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'ETag': etag
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'internal_error' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

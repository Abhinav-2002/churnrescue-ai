export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import crypto from 'crypto';
import { rateLimit, LIMITS } from '@/lib/rate-limit';

const responseSchema = z.object({
  customers: z.array(z.object({
    id: z.string(),
    name: z.string(),
    plan: z.string(),
    price_cents: z.number(),
    usage_percent: z.number(),
    status: z.string(),
    last_action: z.string().nullable(),
    last_action_at: z.string().nullable()
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
  })),
  daily_series: z.array(z.object({
    date: z.string(),
    failed_amount_cents: z.number(),
    recovered_amount_cents: z.number()
  })),
  funnel: z.object({
    failed: z.number(),
    offered: z.number(),
    accepted: z.number(),
    paid: z.number()
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
  })
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

export async function GET(req: Request) {
  const limited = rateLimit(req, LIMITS.dashboardMetrics);
  if (limited) return limited;

  try {
    const db = getDb();
    
    // Customers
    const customersRaw = db.prepare(`
      SELECT 
        c.id, c.name, c.plan_name as plan, c.plan_price_cents as price_cents, 
        c.usage_percent, c.status,
        (SELECT action FROM agent_actions WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1) as last_action,
        (SELECT created_at FROM agent_actions WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1) as last_action_at
      FROM customers c
    `).all() as any[];
    
    // Offers
    const offers = db.prepare(`
      SELECT id, customer_id, kind, discount_percent, ladder_step, amount_cents, status, created_at
      FROM offers
      ORDER BY created_at DESC
      LIMIT 200
    `).all() as any[];
    
    // Recoveries
    const recoveries = db.prepare(`
      SELECT customer_id, original_amount_cents, recovered_amount_cents, created_at
      FROM recoveries
      ORDER BY created_at DESC
      LIMIT 200
    `).all() as any[];

    // Decisions
    const agentActions = db.prepare(`
      SELECT created_at, customer_id, action, details_json
      FROM agent_actions
      ORDER BY created_at DESC
      LIMIT 100
    `).all() as any[];
    
    const decisions = agentActions.map(a => {
      let details: any = {};
      try { details = JSON.parse(a.details_json); } catch(e) {}
      
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

    // Daily Series (UTC)
    const seriesFailed = db.prepare(`
      SELECT DATE(created_at) as date, SUM(amount_cents) as total
      FROM billing_events
      WHERE status = 'failed'
      GROUP BY DATE(created_at)
    `).all() as any[];
    
    const seriesRecovered = db.prepare(`
      SELECT DATE(created_at) as date, SUM(recovered_amount_cents) as total
      FROM recoveries
      GROUP BY DATE(created_at)
    `).all() as any[];

    const dates = new Set([...seriesFailed.map(s => s.date), ...seriesRecovered.map(s => s.date)]);
    const daily_series = Array.from(dates).sort().map(date => {
      const f = seriesFailed.find(s => s.date === date);
      const r = seriesRecovered.find(s => s.date === date);
      return {
        date,
        failed_amount_cents: f ? f.total : 0,
        recovered_amount_cents: r ? r.total : 0
      };
    });

    // Funnel & KPIs
    const totalFailed = (db.prepare(`SELECT COUNT(*) as c FROM billing_events WHERE status = 'failed'`).get() as any).c;
    const totalOffered = (db.prepare(`SELECT COUNT(*) as c FROM offers WHERE status != 'superseded'`).get() as any).c;
    const totalAccepted = (db.prepare(`SELECT COUNT(*) as c FROM offers WHERE status = 'accepted'`).get() as any).c;
    const totalPaid = (db.prepare(`SELECT COUNT(*) as c FROM recoveries`).get() as any).c;
    
    const atRisk = customersRaw.filter(c => c.status === 'at_risk').length;
    const paused = customersRaw.filter(c => c.status === 'paused').length;
    const escalated = customersRaw.filter(c => c.last_action === 'escalate').length;
    
    const discountOffers = offers.filter(o => o.status !== 'superseded' && o.discount_percent != null && o.discount_percent > 0);
    const averageDiscount = discountOffers.length > 0 
      ? discountOffers.reduce((sum, o) => sum + o.discount_percent, 0) / discountOffers.length
      : 0;

    // Median hours
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
      customers: customersRaw,
      offers,
      recoveries,
      decisions,
      daily_series,
      funnel: {
        failed: totalFailed,
        offered: totalOffered,
        accepted: totalAccepted,
        paid: totalPaid
      },
      kpis: {
        total_failed: totalFailed,
        total_recovered: totalPaid,
        recovery_rate: totalFailed > 0 ? (totalPaid / totalFailed) : 0,
        at_risk: atRisk,
        paused: paused,
        escalated: escalated,
        average_discount: averageDiscount,
        median_hours_to_recovery: medianHours
      }
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

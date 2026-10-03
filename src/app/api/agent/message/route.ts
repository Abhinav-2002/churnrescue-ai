import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { graph } from '@/lib/agent/graph';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { formatDollars } from '@/lib/money';

const ipCounts = new Map<string, { count: number, resetAt: number }>();

function rateLimit(req: Request): boolean {
  const ip = req.headers.get('x-forwarded-for') || '127.0.0.1';
  const now = Date.now();
  const entry = ipCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    ipCounts.set(ip, { count: 1, resetAt: now + 60000 });
    return true;
  }
  if (entry.count >= 20) return false;
  entry.count++;
  return true;
}

const reqSchema = z.object({
  customerId: z.string(),
  text: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  if (!rateLimit(req)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const rawBody = await req.json();
    const parsed = reqSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }
    const { customerId, text } = parsed.data;

    const db = getDb();
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) as any;
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }
    if (customer.status !== 'at_risk') {
      return NextResponse.json({ error: 'Customer is not at_risk' }, { status: 400 });
    }

    const msgCount = db.prepare(`SELECT COUNT(*) as c FROM conversations WHERE customer_id = ? AND role = 'customer'`).get(customerId) as { c: number };
    if (msgCount.c >= 12 && text) {
      return NextResponse.json({ error: 'Conversation limit reached.' }, { status: 400 });
    }

    if (text) {
      db.prepare(`INSERT INTO conversations (id, customer_id, role, text, created_at) VALUES (?, ?, ?, ?, ?)`).run(
        `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        customerId,
        'customer',
        text,
        new Date().toISOString()
      );
    }

    const billingEvent = db.prepare(`SELECT id FROM billing_events WHERE customer_id = ? AND status = 'failed' ORDER BY created_at DESC LIMIT 1`).get(customerId) as any;
    if (!billingEvent) {
      return NextResponse.json({ error: 'No failed billing event found' }, { status: 400 });
    }
    
    const historyRows = db.prepare('SELECT * FROM conversations WHERE customer_id = ? ORDER BY created_at ASC').all(customerId) as any[];
    const messages = historyRows.map(row => 
      row.role === 'customer' ? new HumanMessage(row.text) : new AIMessage(row.text)
    );

    if (messages.length === 0) {
      messages.push(new HumanMessage("Hello, I see my payment failed."));
    }

    const state = { customerId, billingEventId: billingEvent.id, messages };
    
    let out;
    try {
      out = await Promise.race([
        graph.invoke(state, { configurable: { modelId: process.env.LLM_MODEL } }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Agent timeout')), 30000))
      ]) as any;
    } catch (e: any) {
      console.error('LLM Failure:', e);
      // fallback
      const latestOffer = db.prepare('SELECT * FROM offers WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1').get(customerId) as any;
      let reply = 'I apologize, but I am experiencing technical difficulties. ';
      if (latestOffer && latestOffer.status === 'pending') {
        if (latestOffer.kind === 'pause') {
          reply += 'Your subscription will be paused with no charge. Please confirm if you want to proceed.';
        } else {
          reply += `We can offer a new amount of ${formatDollars(latestOffer.amount_cents)}. Would you like to proceed?`;
        }
      } else {
        reply += `Your payment failed. Your plan stays at ${formatDollars(customer.plan_price_cents)}. No discount available. Would you like to proceed?`;
      }
      return NextResponse.json({ reply, nextStep: 'none' });
    }

    const lastMsg = out.messages[out.messages.length - 1].content;
    const latestOffer = db.prepare('SELECT * FROM offers WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1').get(customerId) as any;
    
    let nextStep = 'none';
    let responseObj: any = { reply: lastMsg, nextStep };
    db.prepare(`INSERT INTO conversations (id, customer_id, role, text, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      customerId,
      'agent',
      lastMsg,
      new Date().toISOString()
    );

    if (out.intent === 'escalate' || out.decision?.action === 'escalate') {
      responseObj.nextStep = 'escalated';
    } else if (latestOffer) {
      if (latestOffer.kind === 'pause' && latestOffer.status === 'pending') {
        responseObj.nextStep = 'confirm_pause';
        responseObj.offerId = latestOffer.id;
      } else if (latestOffer.status === 'accepted' && latestOffer.paypal_order_id && latestOffer.amount_cents > 0) {
        responseObj.nextStep = 'pay';
        responseObj.offerId = latestOffer.id;
        responseObj.orderId = latestOffer.paypal_order_id;
        responseObj.amountCents = latestOffer.amount_cents;
      }
    }
    
    return NextResponse.json(responseObj);
  } catch (err: any) {
    console.error('Route error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

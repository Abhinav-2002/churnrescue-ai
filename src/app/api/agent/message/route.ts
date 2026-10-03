import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { graph } from '@/lib/agent/graph';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

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

export async function POST(req: Request) {
  if (!rateLimit(req)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const { customerId, text } = await req.json();
    if (!customerId) return NextResponse.json({ error: 'Missing customerId' }, { status: 400 });
    
    if (text && text.length > 500) {
      return NextResponse.json({ error: 'Message too long' }, { status: 400 });
    }

    const db = getDb();
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
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
    
    const msgCount = db.prepare('SELECT COUNT(*) as c FROM conversations WHERE customer_id = ?').get(customerId) as { c: number };
    if (msgCount.c >= 12) {
      return NextResponse.json({ error: 'Conversation limit reached.' }, { status: 400 });
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
    
    const out = await Promise.race([
      graph.invoke(state, { configurable: { modelId: process.env.LLM_MODEL } }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Agent timeout')), 30000))
    ]) as any;

    const lastMsg = out.messages[out.messages.length - 1].content;
    const dbOut = getDb();
    const latestOffer = dbOut.prepare('SELECT * FROM offers WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1').get(customerId) as any;
    
    let nextStep = 'none';
    let responseObj: any = { reply: lastMsg, nextStep };

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
      } else if (latestOffer.status === 'pending' && latestOffer.kind !== 'pause') {
        // Offer is made but not accepted yet, waiting for user to say yes.
        // Wait, the instructions say:
        // "offerId and orderId only when the offer is accepted AND (for pay) an order exists."
        // So we don't return them if pending (except for pause which uses confirm_pause without an order).
        // Wait! How does the frontend know there is an offer to accept? The LLM asked them.
        // Or if the LLM says "we can offer $20, say yes", the nextStep is just 'none'.
      }
    }
    
    return NextResponse.json(responseObj);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

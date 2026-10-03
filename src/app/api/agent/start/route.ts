import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { graph } from '@/lib/agent/graph';
import { HumanMessage } from '@langchain/core/messages';

export async function POST(req: Request) {
  try {
    const { customerId } = await req.json();
    if (!customerId) return NextResponse.json({ error: 'Missing customerId' }, { status: 400 });

    const db = getDb();
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) as any;
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    if (customer.status === 'healthy') return NextResponse.json({ error: 'Customer is healthy' }, { status: 400 });

    const billingEvent = db.prepare(`SELECT id FROM billing_events WHERE customer_id = ? AND status = 'failed' ORDER BY created_at DESC LIMIT 1`).get(customerId) as any;
    if (!billingEvent) return NextResponse.json({ error: 'No failed billing event found' }, { status: 400 });

    const initialText = "Hello, I see my payment failed. What are my options?";
    
    db.prepare(`INSERT INTO conversations (id, customer_id, role, text, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      customerId,
      'customer',
      initialText,
      new Date().toISOString()
    );

    const state = {
      customerId,
      billingEventId: billingEvent.id,
      messages: [new HumanMessage(initialText)]
    };

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
      }
    }
    
    return NextResponse.json(responseObj);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

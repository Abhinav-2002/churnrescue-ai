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

    const billingEvent = db.prepare('SELECT id FROM billing_events WHERE customer_id = ? AND status = "failed" ORDER BY created_at DESC LIMIT 1').get(customerId) as any;
    if (!billingEvent) return NextResponse.json({ error: 'No failed billing event found' }, { status: 400 });

    const state = {
      customerId,
      billingEventId: billingEvent.id,
      messages: [new HumanMessage("Hello, I see my payment failed. What are my options?")]
    };

    const out = await Promise.race([
      graph.invoke(state, { configurable: { modelId: process.env.LLM_MODEL } }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Agent timeout')), 30000))
    ]) as any;

    const lastMsg = out.messages[out.messages.length - 1].content;
    const activeOffer = db.prepare('SELECT id, paypal_order_id FROM offers WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1').get(customerId) as any;
    
    return NextResponse.json({ 
      reply: lastMsg, 
      offerId: activeOffer?.id, 
      orderId: activeOffer?.paypal_order_id 
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { graph } from '@/lib/agent/graph';
import { HumanMessage } from '@langchain/core/messages';
import { rateLimit, LIMITS, tryConsumeLlmRun, BUSY_REPLY } from '@/lib/rate-limit';

export async function POST(req: Request) {
  const limited = rateLimit(req, LIMITS.agentStart);
  if (limited) return limited;

  try {
    const { customerId } = await req.json();
    if (!customerId) return NextResponse.json({ error: 'missing_customer_id' }, { status: 400 });

    const db = getDb();
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) as any;
    if (!customer) return NextResponse.json({ error: 'customer_not_found' }, { status: 404 });
    if (customer.status === 'healthy') return NextResponse.json({ error: 'customer_healthy' }, { status: 400 });

    const billingEvent = db.prepare(`SELECT id FROM billing_events WHERE customer_id = ? AND status = 'failed' ORDER BY created_at DESC LIMIT 1`).get(customerId) as any;
    if (!billingEvent) return NextResponse.json({ error: 'no_failed_billing_event' }, { status: 400 });

    // One budget unit per graph run. When exhausted: no model call, nothing persisted,
    // no escalation recorded, customer state untouched.
    if (!tryConsumeLlmRun()) {
      return NextResponse.json({ reply: BUSY_REPLY, nextStep: 'none', busy: true });
    }

    const instruction = "Start the conversation proactively. The customer's payment failed. Propose an appropriate retention offer based on their usage.";
    
    const state = {
      customerId,
      billingEventId: billingEvent.id,
      messages: [new HumanMessage(instruction)]
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
    console.error('agent/start error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

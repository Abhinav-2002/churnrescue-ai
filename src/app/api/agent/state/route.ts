import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { z } from 'zod';

const schema = z.object({
  customerId: z.string().min(1)
});

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get('customerId');
    
    const parsed = schema.safeParse({ customerId });
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
    }

    const db = getDb();
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) as any;
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const convs = db.prepare('SELECT role, text FROM conversations WHERE customer_id = ? ORDER BY created_at ASC, id ASC').all(customerId) as any[];
    
    let nextStep = 'none';
    let offerId = null;
    let orderId = null;
    let amountCents = null;

    const offer = db.prepare(`SELECT * FROM offers WHERE customer_id = ? AND status IN ('pending', 'accepted', 'capturing', 'needs_review') ORDER BY created_at DESC LIMIT 1`).get(customerId) as any;

    if (offer) {
      if (offer.status === 'accepted' || offer.status === 'capturing' || offer.status === 'needs_review') {
        if (offer.amount_cents > 0 && offer.paypal_order_id) {
          nextStep = 'pay';
          offerId = offer.id;
          orderId = offer.paypal_order_id;
          amountCents = offer.amount_cents;
        }
      } else if (offer.status === 'pending') {
        if (offer.kind === 'pause') {
          nextStep = 'confirm_pause';
          offerId = offer.id;
        }
      }
    }

    if (nextStep === 'none' && customer.status === 'at_risk' && convs.length > 0) {
      const lastMsg = convs[convs.length - 1];
      if (lastMsg.role === 'agent' && lastMsg.text.includes('flagged for our billing team')) {
        nextStep = 'escalated';
      }
    }

    return NextResponse.json({
      customer: {
        status: customer.status
      },
      messages: convs,
      nextStep,
      ...(offerId && { offerId }),
      ...(orderId && { orderId }),
      ...(amountCents !== null && { amountCents })
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { createOrder, captureOrder } from '@/lib/paypal';
import { handlePaymentFailed } from '@/lib/failures';
import crypto from 'crypto';

export async function POST(request: Request) {
  try {
    const { customerId } = await request.json();
    if (!customerId) return NextResponse.json({ error: 'Missing customerId' }, { status: 400 });

    const db = getDb();
    const customer = db.prepare('SELECT plan_price_cents, status FROM customers WHERE id = ?').get(customerId) as any;
    
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    if (customer.status === 'at_risk') return NextResponse.json({ error: 'Customer already at_risk' }, { status: 400 });

    // 1. Create billing_event (pending)
    const billingEventId = `be_${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO billing_events (id, customer_id, type, amount_cents, status)
      VALUES (?, ?, 'renewal', ?, 'pending')
    `).run(billingEventId, customerId, customer.plan_price_cents);

    // 2. Create PayPal order
    const order = await createOrder(customer.plan_price_cents, 'USD', billingEventId);
    
    // 3. Capture with forceDecline
    const { status, body } = await captureOrder(order.id, { forceDecline: true });
    
    // 4. Handle response
    const issue = body?.details?.[0]?.issue;
    
    if (status === 422 && issue === 'INSTRUMENT_DECLINED') {
      const result = handlePaymentFailed({
        customerId,
        billingEventId,
        source: 'api_response',
        paypalErrorCode: issue,
        idempotencyKey: `capture_failed:${order.id}`,
        amountCents: customer.plan_price_cents,
        paypalOrderId: order.id
      });
      return NextResponse.json({ success: true, result, orderId: order.id });
    } else {
      // Any other error -> mark event as error, do NOT mark customer at_risk
      db.prepare(`
        UPDATE billing_events SET status = 'error', paypal_order_id = ?, paypal_error_code = ? WHERE id = ?
      `).run(order.id, issue || 'UNKNOWN_ERROR', billingEventId);
      
      return NextResponse.json({ 
        error: 'Payment failed but not an INSTRUMENT_DECLINED', 
        status, 
        issue 
      }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Simulate failure error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

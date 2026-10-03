import { NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/paypal';
import { handlePaymentFailed } from '@/lib/failures';
import { getDb } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // 1. Verify signature
    const isValid = await verifyWebhookSignature(headers, rawBody);
    if (!isValid) {
      console.warn('Webhook signature verification failed');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const event = JSON.parse(rawBody);

    // 2. Handle PAYMENT.CAPTURE.DENIED
    if (event.event_type === 'PAYMENT.CAPTURE.DENIED') {
      const captureId = event.resource?.id;
      // In a real scenario, the resource has an order ID or custom_id. 
      // For this sandbox, we can extract the order ID from the parent_payment or links.
      const orderLink = event.resource?.links?.find((l: any) => l.rel === 'up');
      const orderId = orderLink ? orderLink.href.split('/').pop() : 'UNKNOWN_ORDER';
      const amountCents = parseInt(event.resource?.amount?.value?.replace('.', '') || '0', 10);
      
      // We need customerId. We might find it in the DB by looking up the pending billing_event
      // if we stored the orderId earlier, or by passing a custom_id. Since we don't have it easily
      // mapped in this webhook payload unless we pass custom_id, we'll try to find it by paypal_order_id
      // but wait, paypal_order_id was updated in simulate-failure API. 
      // This is just to demonstrate idempotency. We'll extract customer_id from DB if possible.
      const db = getDb();
      const existingEvent = db.prepare('SELECT customer_id, id FROM billing_events WHERE paypal_order_id = ?').get(orderId) as any;
      
      if (!existingEvent) {
        console.warn('Received webhook for unknown order', orderId);
        return NextResponse.json({ success: true, note: 'Order not found in DB' });
      }

      handlePaymentFailed({
        customerId: existingEvent.customer_id,
        billingEventId: existingEvent.id,
        source: 'webhook',
        paypalErrorCode: 'INSTRUMENT_DECLINED', // Default assumption for DENIED event in this demo
        idempotencyKey: `capture_failed:${orderId}`,
        amountCents,
        paypalOrderId: orderId
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

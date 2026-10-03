import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getOrder, captureOrder } from '@/lib/paypal';

export async function POST(req: Request, { params }: { params: Promise<{ offerId: string }> | { offerId: string } }) {
  try {
    const offerId = 'offerId' in params ? params.offerId : (await params).offerId;

    const db = getDb();
    const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) as any;
    
    if (!offer) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }

    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(offer.customer_id) as any;
    if (customer.status !== 'at_risk') {
      return NextResponse.json({ error: 'Customer is not at_risk' }, { status: 400 });
    }

    if (offer.status !== 'accepted' && offer.status !== 'captured') {
      return NextResponse.json({ error: 'Offer is not accepted' }, { status: 400 });
    }

    if (new Date(offer.expires_at).getTime() < Date.now() && offer.status !== 'captured') {
      return NextResponse.json({ error: 'Offer expired' }, { status: 400 });
    }

    if (offer.status === 'captured') {
      // Idempotent return
      return NextResponse.json({ success: true, status: 'captured' });
    }

    // Handle 'pause' separately
    if (offer.kind === 'pause') {
      db.transaction(() => {
        db.prepare(`UPDATE offers SET status = 'captured' WHERE id = ?`).run(offer.id);
        db.prepare(`UPDATE customers SET status = 'paused' WHERE id = ?`).run(customer.id);
        db.prepare(`UPDATE billing_events SET status = 'paused' WHERE id = ?`).run(offer.billing_event_id);
      })();
      return NextResponse.json({ success: true, status: 'captured' });
    }

    // PayPal payment check
    if (!offer.paypal_order_id) {
      return NextResponse.json({ error: 'No paypal order associated with offer' }, { status: 400 });
    }

    const paypalOrder = await getOrder(offer.paypal_order_id);
    if (paypalOrder.status !== 'APPROVED') {
      return NextResponse.json({ error: `PayPal order is in status: ${paypalOrder.status}, expected APPROVED` }, { status: 400 });
    }

    const orderAmountStr = paypalOrder.purchase_units[0].amount.value;
    const orderAmountCents = Math.round(parseFloat(orderAmountStr) * 100);
    
    if (orderAmountCents !== offer.amount_cents) {
      return NextResponse.json({ error: `Amount mismatch. Offer is ${offer.amount_cents} cents but PayPal order is ${orderAmountCents} cents` }, { status: 400 });
    }

    const captureResult = await captureOrder(offer.paypal_order_id);
    
    if (captureResult.status !== 201 && captureResult.status !== 200) {
      // Capture declined (e.g. INSTRUMENT_DECLINED)
      // Keep customer at_risk, mark offer as failed
      db.prepare(`UPDATE offers SET status = 'failed' WHERE id = ?`).run(offer.id);
      return NextResponse.json({ error: 'Capture declined by PayPal', details: captureResult.body }, { status: 400 });
    }

    const capturedAmountStr = captureResult.body.purchase_units[0].payments.captures[0].amount.value;
    const capturedAmountCents = Math.round(parseFloat(capturedAmountStr) * 100);

    if (capturedAmountCents !== offer.amount_cents) {
       return NextResponse.json({ error: `Amount mismatch after capture. Expected ${offer.amount_cents} cents but captured ${capturedAmountCents} cents` }, { status: 400 });
    }

    // One DB transaction for recovery
    db.transaction(() => {
      const recoveryId = `rec_${Date.now()}_${Math.random().toString(36).substring(2,7)}`;
      db.prepare(`
        INSERT INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(recoveryId, customer.id, offer.billing_event_id, customer.plan_price_cents, capturedAmountCents, offer.paypal_order_id);
      
      db.prepare(`UPDATE offers SET status = 'captured' WHERE id = ?`).run(offer.id);
      db.prepare(`UPDATE customers SET status = 'recovered' WHERE id = ?`).run(customer.id);
      db.prepare(`UPDATE billing_events SET status = 'recovered' WHERE id = ?`).run(offer.billing_event_id);
    })();

    return NextResponse.json({ success: true, status: 'captured' });

  } catch (err: any) {
    console.error('Capture endpoint error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

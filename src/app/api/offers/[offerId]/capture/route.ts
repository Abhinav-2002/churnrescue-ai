import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getOrder, captureOrder } from '@/lib/paypal';

export async function POST(req: Request, { params }: { params: Promise<{ offerId: string }> | { offerId: string } }) {
  try {
    const offerId = 'offerId' in params ? params.offerId : (await params).offerId;

    const db = getDb();
    let offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) as any;
    
    if (!offer) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }

    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(offer.customer_id) as any;
    if (customer.status !== 'at_risk') {
      return NextResponse.json({ error: 'Customer is not at_risk' }, { status: 400 });
    }

    if (new Date(offer.expires_at).getTime() < Date.now() && offer.status !== 'captured') {
      return NextResponse.json({ error: 'Offer expired' }, { status: 400 });
    }

    // Handle 'pause' separately
    if (offer.kind === 'pause') {
      if (offer.status === 'captured') return NextResponse.json({ success: true, status: 'captured' });
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

    if (offer.status === 'captured') {
      return NextResponse.json({ success: true, status: 'captured' });
    }
    
    // Concurrency & Crash recovery
    if (offer.status === 'capturing') {
      const capturingAt = offer.capturing_at ? new Date(offer.capturing_at).getTime() : 0;
      if (Date.now() - capturingAt < 120000) { // 2 minutes
        return NextResponse.json({ error: 'Offer is currently being captured' }, { status: 409 });
      }
      // If stuck > 2 minutes, proceed with reconciliation
    } else if (offer.status === 'accepted') {
      const updateRes = db.prepare(`UPDATE offers SET status = 'capturing', capturing_at = ? WHERE id = ? AND status = 'accepted'`).run(new Date().toISOString(), offer.id);
      if (updateRes.changes === 0) {
        // Someone else grabbed it
        offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) as any;
        if (offer.status === 'captured') {
           return NextResponse.json({ success: true, status: 'captured' });
        }
        return NextResponse.json({ error: 'Offer is currently being captured' }, { status: 409 });
      }
      offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) as any;
    } else {
       return NextResponse.json({ error: 'Offer is not accepted' }, { status: 400 });
    }

    // Order status from PayPal
    const paypalOrder = await getOrder(offer.paypal_order_id);
    let capturedAmountStr = '';

    if (paypalOrder.status === 'COMPLETED') {
      // Reconcile already completed order (crash recovery)
      capturedAmountStr = paypalOrder.purchase_units[0].payments.captures[0].amount.value;
    } else if (paypalOrder.status === 'APPROVED') {
      const orderAmountStr = paypalOrder.purchase_units[0].amount.value;
      const orderAmountCents = Math.round(parseFloat(orderAmountStr) * 100);
      
      if (orderAmountCents !== offer.amount_cents) {
        db.prepare(`UPDATE offers SET status = 'failed' WHERE id = ?`).run(offer.id);
        return NextResponse.json({ error: `Amount mismatch. Offer is ${offer.amount_cents} cents but PayPal order is ${orderAmountCents} cents` }, { status: 400 });
      }

      const captureResult = await captureOrder(offer.paypal_order_id);
      
      if (captureResult.status !== 201 && captureResult.status !== 200) {
        // If ALREADY_CAPTURED error returned, reconcile instead of failing
        const isAlreadyCaptured = captureResult.body?.name === 'ORDER_ALREADY_CAPTURED' || 
                                  captureResult.body?.details?.[0]?.issue === 'ORDER_ALREADY_CAPTURED';
        
        if (isAlreadyCaptured) {
           const recheckOrder = await getOrder(offer.paypal_order_id);
           if (recheckOrder.status === 'COMPLETED') {
             capturedAmountStr = recheckOrder.purchase_units[0].payments.captures[0].amount.value;
           } else {
             db.prepare(`UPDATE offers SET status = 'failed' WHERE id = ?`).run(offer.id);
             return NextResponse.json({ error: 'Capture failed and order is not COMPLETED', details: captureResult.body }, { status: 400 });
           }
        } else {
          // Decline (INSTRUMENT_DECLINED)
          db.prepare(`UPDATE offers SET status = 'failed' WHERE id = ?`).run(offer.id);
          return NextResponse.json({ error: 'Capture declined by PayPal', details: captureResult.body }, { status: 400 });
        }
      } else {
        capturedAmountStr = captureResult.body.purchase_units[0].payments.captures[0].amount.value;
      }
    } else {
      db.prepare(`UPDATE offers SET status = 'failed' WHERE id = ?`).run(offer.id);
      return NextResponse.json({ error: `PayPal order is in status: ${paypalOrder.status}, expected APPROVED` }, { status: 400 });
    }

    const capturedAmountCents = Math.round(parseFloat(capturedAmountStr) * 100);

    if (capturedAmountCents !== offer.amount_cents) {
       db.prepare(`UPDATE offers SET status = 'failed' WHERE id = ?`).run(offer.id);
       return NextResponse.json({ error: `Amount mismatch after capture. Expected ${offer.amount_cents} cents but captured ${capturedAmountCents} cents` }, { status: 400 });
    }

    // One DB transaction for recovery
    db.transaction(() => {
      const recoveryId = `rec_${Date.now()}_${Math.random().toString(36).substring(2,7)}`;
      // INSERT OR IGNORE just in case of weird idempotency repeats where row exists but offer status wasn't updated
      db.prepare(`
        INSERT OR IGNORE INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id)
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

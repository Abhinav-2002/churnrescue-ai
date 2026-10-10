import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getOrder, captureOrder } from '@/lib/paypal';
import { rateLimit, LIMITS } from '@/lib/rate-limit';

export async function POST(req: Request, { params }: { params: Promise<{ offerId: string }> | { offerId: string } }) {
  const limited = rateLimit(req, LIMITS.capture);
  if (limited) return limited;

  try {
    const offerId = 'offerId' in params ? params.offerId : (await params).offerId;

    const db = getDb();
    let offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) as any;
    
    if (!offer) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }

    if (offer.status === 'captured') {
      return NextResponse.json({ success: true, status: 'captured' });
    }

    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(offer.customer_id) as any;
    if (customer.status !== 'at_risk') {
      return NextResponse.json({ error: 'Customer is not at_risk' }, { status: 400 });
    }

    if (offer.status === 'superseded') {
      return NextResponse.json({ error: 'offer_superseded' }, { status: 400 });
    }

    if (!offer.paypal_order_id) {
      return NextResponse.json({ error: 'No paypal order associated with offer' }, { status: 400 });
    }
    
    if (offer.status === 'capturing') {
      const capturingAt = offer.capturing_at ? new Date(offer.capturing_at).getTime() : 0;
      if (Date.now() - capturingAt < 120000) { 
        return NextResponse.json({ error: 'in_progress' }, { status: 409 });
      }
    } else if (offer.status === 'accepted') {
      const updateRes = db.prepare(`UPDATE offers SET status = 'capturing', capturing_at = ? WHERE id = ? AND status = 'accepted'`).run(new Date().toISOString(), offer.id);
      if (updateRes.changes === 0) {
        offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) as any;
        if (offer.status === 'captured') {
           return NextResponse.json({ success: true, status: 'captured' });
        }
        return NextResponse.json({ error: 'in_progress' }, { status: 409 });
      }
      offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) as any;
    } else {
       return NextResponse.json({ error: 'Offer is not accepted' }, { status: 400 });
    }

    let paypalOrder: any;
    try {
      paypalOrder = await getOrder(offer.paypal_order_id);
    } catch (err: any) {
      console.error('get-order failure:', err);
      db.prepare(`UPDATE offers SET status = 'accepted', capturing_at = NULL WHERE id = ?`).run(offer.id);
      return NextResponse.json({ error: 'get_order_failed' }, { status: 500 });
    }

    let capturedAmountStr = '';

    if (paypalOrder.status === 'COMPLETED') {
      capturedAmountStr = paypalOrder.purchase_units[0].payments.captures[0].amount.value;
    } else if (paypalOrder.status === 'APPROVED') {
      if (new Date(offer.expires_at).getTime() < Date.now()) {
        db.prepare(`UPDATE offers SET status = 'superseded', capturing_at = NULL WHERE id = ?`).run(offer.id);
        const expOfferId = `off_${Date.now()}_${Math.random().toString(36).substring(2,7)}`;
        db.prepare(`INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, discount_percent, ladder_step, target_plan, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`).run(expOfferId, offer.customer_id, offer.billing_event_id, offer.kind, offer.amount_cents, offer.discount_percent, offer.ladder_step, offer.target_plan);
        return NextResponse.json({ error: 'expired' }, { status: 400 });
      }

      const orderAmountStr = paypalOrder.purchase_units[0].amount.value;
      const orderAmountCents = Math.round(parseFloat(orderAmountStr) * 100);
      
      if (orderAmountCents !== offer.amount_cents) {
        db.prepare(`UPDATE offers SET status = 'needs_review' WHERE id = ?`).run(offer.id);
        console.error(`SEVERE: Amount mismatch pre-capture for offer ${offer.id}. Expected ${offer.amount_cents} cents but PayPal order is ${orderAmountCents} cents.`);
        return NextResponse.json({ error: 'amount_mismatch' }, { status: 400 });
      }

      let captureResult: any;
      try {
        captureResult = await captureOrder(offer.paypal_order_id);
      } catch (err: any) {
        console.error('captureOrder network/fatal error:', err);
        return NextResponse.json({ error: 'capture_unknown' }, { status: 500 });
      }
      
      if (captureResult.status !== 201 && captureResult.status !== 200) {
        const isAlreadyCaptured = captureResult.body?.name === 'ORDER_ALREADY_CAPTURED' || 
                                  captureResult.body?.details?.[0]?.issue === 'ORDER_ALREADY_CAPTURED';
        
        if (isAlreadyCaptured) {
           try {
             const recheckOrder = await getOrder(offer.paypal_order_id);
             if (recheckOrder.status === 'COMPLETED') {
               capturedAmountStr = recheckOrder.purchase_units[0].payments.captures[0].amount.value;
             } else {
               db.prepare(`UPDATE offers SET status = 'failed', paypal_order_status = 'declined' WHERE id = ?`).run(offer.id);
               const newOfferId = `off_${Date.now()}_${Math.random().toString(36).substring(2,7)}`;
               db.prepare(`INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, discount_percent, ladder_step, target_plan, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`).run(newOfferId, offer.customer_id, offer.billing_event_id, offer.kind, offer.amount_cents, offer.discount_percent, offer.ladder_step, offer.target_plan);
               return NextResponse.json({ error: 'declined' }, { status: 400 });
             }
           } catch(e) {
             console.error('Recheck order failed', e);
             return NextResponse.json({ error: 'capture_unknown' }, { status: 500 });
           }
        } else {
          console.error('PayPal Capture Declined:', captureResult.body);
          db.prepare(`UPDATE offers SET status = 'failed', paypal_order_status = 'declined' WHERE id = ?`).run(offer.id);
          const newOfferId = `off_${Date.now()}_${Math.random().toString(36).substring(2,7)}`;
          db.prepare(`INSERT INTO offers (id, customer_id, billing_event_id, kind, amount_cents, discount_percent, ladder_step, target_plan, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`).run(newOfferId, offer.customer_id, offer.billing_event_id, offer.kind, offer.amount_cents, offer.discount_percent, offer.ladder_step, offer.target_plan);
          return NextResponse.json({ error: 'declined' }, { status: 400 }); 
        }
      } else {
        capturedAmountStr = captureResult.body.purchase_units[0].payments.captures[0].amount.value;
      }
    } else {
      db.prepare(`UPDATE offers SET status = 'accepted', capturing_at = NULL WHERE id = ?`).run(offer.id);
      return NextResponse.json({ error: 'not_approved' }, { status: 400 });
    }

    const capturedAmountCents = Math.round(parseFloat(capturedAmountStr) * 100);

    if (capturedAmountCents !== offer.amount_cents) {
       console.error(`SEVERE: Amount mismatch after capture for offer ${offer.id}. Expected ${offer.amount_cents} cents but captured ${capturedAmountCents} cents.`);
       db.prepare(`UPDATE offers SET status = 'needs_review' WHERE id = ?`).run(offer.id);
       return NextResponse.json({ error: 'amount_mismatch_after_capture' }, { status: 400 });
    }

    db.transaction(() => {
      const recoveryId = `rec_${Date.now()}_${Math.random().toString(36).substring(2,7)}`;
      db.prepare(`
        INSERT OR IGNORE INTO recoveries (id, customer_id, billing_event_id, original_amount_cents, recovered_amount_cents, paypal_order_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(recoveryId, customer.id, offer.billing_event_id, customer.plan_price_cents, capturedAmountCents, offer.paypal_order_id);
      
      db.prepare(`UPDATE offers SET status = 'captured', paypal_order_status = 'captured' WHERE id = ?`).run(offer.id);
      db.prepare(`UPDATE customers SET status = 'recovered' WHERE id = ?`).run(customer.id);
      db.prepare(`UPDATE billing_events SET status = 'recovered' WHERE id = ?`).run(offer.billing_event_id);
    })();

    return NextResponse.json({ success: true, status: 'captured' });

  } catch (err: any) {
    console.error('Capture endpoint error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

import { getDb } from './db';
import crypto from 'crypto';

export function enqueueAgentRun(customerId: string, billingEventId: string) {
  // STUB for Phase 3
  console.log(`[STUB] enqueueAgentRun called for customer ${customerId}, billing event ${billingEventId}`);
}

export function handlePaymentFailed({
  customerId,
  billingEventId,
  source,
  paypalErrorCode,
  idempotencyKey,
  amountCents,
  paypalOrderId
}: {
  customerId: string;
  billingEventId?: string; // Original pending event if from api_response
  source: 'api_response' | 'webhook';
  paypalErrorCode: string;
  idempotencyKey: string;
  amountCents: number;
  paypalOrderId: string;
}) {
  const db = getDb();

  return db.transaction(() => {
    // Check for idempotency
    const existing = db.prepare('SELECT id FROM billing_events WHERE idempotency_key = ?').get(idempotencyKey) as any;
    
    if (existing) {
      return { status: 'already_processed', billingEventId: existing.id };
    }

    let finalBillingEventId = billingEventId;

    if (!finalBillingEventId) {
      finalBillingEventId = `be_${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO billing_events (id, customer_id, type, amount_cents, status, paypal_order_id, paypal_error_code, idempotency_key)
        VALUES (?, ?, 'renewal', ?, 'failed', ?, ?, ?)
      `).run(finalBillingEventId, customerId, amountCents, paypalOrderId, paypalErrorCode, idempotencyKey);
    } else {
      // Update existing pending event
      db.prepare(`
        UPDATE billing_events 
        SET status = 'failed', paypal_error_code = ?, idempotency_key = ?, paypal_order_id = ?
        WHERE id = ?
      `).run(paypalErrorCode, idempotencyKey, paypalOrderId, finalBillingEventId);
    }

    // Set customer at_risk
    db.prepare(`UPDATE customers SET status = 'at_risk' WHERE id = ?`).run(customerId);

    // Queue the agent run
    enqueueAgentRun(customerId, finalBillingEventId);

    return { status: 'processed', billingEventId: finalBillingEventId };
  })();
}

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDb, resetDb } from '@/lib/db';
import { handlePaymentFailed } from '@/lib/failures';
import * as paypal from '@/lib/paypal';

describe('Failure Pipeline', () => {
  beforeEach(() => {
    resetDb();
  });

  it('should process failure and set customer at_risk idempotently', () => {
    const db = getDb();
    const customerId = 'c_1';
    
    const res1 = handlePaymentFailed({
      customerId,
      source: 'api_response',
      paypalErrorCode: 'INSTRUMENT_DECLINED',
      idempotencyKey: 'capture_failed:TEST_ORDER',
      amountCents: 2500,
      paypalOrderId: 'TEST_ORDER'
    });

    expect(res1.status).toBe('processed');
    
    // Check customer status
    const c1 = db.prepare('SELECT status FROM customers WHERE id = ?').get(customerId) as any;
    expect(c1.status).toBe('at_risk');

    // Check billing event
    const events = db.prepare('SELECT * FROM billing_events WHERE customer_id = ?').all(customerId) as any[];
    expect(events.length).toBe(1);
    expect(events[0].status).toBe('failed');
    expect(events[0].paypal_error_code).toBe('INSTRUMENT_DECLINED');

    // Second call should be idempotent
    const res2 = handlePaymentFailed({
      customerId,
      source: 'webhook',
      paypalErrorCode: 'INSTRUMENT_DECLINED',
      idempotencyKey: 'capture_failed:TEST_ORDER',
      amountCents: 2500,
      paypalOrderId: 'TEST_ORDER'
    });

    expect(res2.status).toBe('already_processed');
    expect(res2.billingEventId).toBe(res1.billingEventId);

    // Still only 1 event
    const eventsAfter = db.prepare('SELECT * FROM billing_events WHERE customer_id = ?').all(customerId) as any[];
    expect(eventsAfter.length).toBe(1);
  });
});

describe('Webhook Signature Rejection', () => {
  it('should reject invalid webhook signature', async () => {
    // Mock verifyWebhookSignature
    vi.spyOn(paypal, 'verifyWebhookSignature').mockResolvedValue(false);

    // Call webhook API logic
    // We can directly invoke the POST function from route
    const { POST } = await import('@/app/api/paypal/webhook/route');
    
    const request = new Request('http://localhost/api/paypal/webhook', {
      method: 'POST',
      headers: {
        'paypal-transmission-id': 'invalid'
      },
      body: JSON.stringify({ event_type: 'PAYMENT.CAPTURE.DENIED' })
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid signature');
  });
});

process.env.DEMO_MODE = '1';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDb, resetDb } from '@/lib/db';
import { handlePaymentFailed } from '@/lib/failures';
import * as failures from '@/lib/failures';
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

    // Second call should be idempotent (different source, same key)
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

  it('should not mark customer at_risk for non-decline errors', async () => {
    // Testing the API route logic directly or by mocking fetch/DB
    // We will test the API route directly since it handles this logic
    const { POST } = await import('@/app/api/simulate-failure/route');
    const db = getDb();

    // Mock createOrder and captureOrder to simulate a 500 error instead of 422
    vi.spyOn(paypal, 'createOrder').mockResolvedValue({ id: 'NON_DECLINE_ORDER' });
    vi.spyOn(paypal, 'captureOrder').mockResolvedValue({ 
      status: 500, 
      body: { details: [{ issue: 'INTERNAL_SERVER_ERROR' }] } 
    });

    const request = new Request('http://localhost/api/simulate-failure', {
      method: 'POST',
      body: JSON.stringify({ customerId: 'c_3' })
    });
    
    const response = await POST(request);
    expect(response.status).toBe(500);

    // Verify customer is STILL healthy
    const c3 = db.prepare('SELECT status FROM customers WHERE id = ?').get('c_3') as any;
    expect(c3.status).toBe('healthy');

    // Verify billing event is marked as error
    const event = db.prepare('SELECT * FROM billing_events WHERE customer_id = ? AND paypal_order_id = ?').get('c_3', 'NON_DECLINE_ORDER') as any;
    expect(event.status).toBe('error');
    expect(event.paypal_error_code).toBe('INTERNAL_SERVER_ERROR');
  });
});

describe('Webhook Signature Rejection', () => {
  it('should reject invalid webhook signature and not call handlePaymentFailed', async () => {
    const db = getDb();
    
    // Ensure no billing events exist for this test order
    db.exec("DELETE FROM billing_events WHERE paypal_order_id = 'INVALID_ORDER'");
    
    // Mock verifyWebhookSignature to fail
    vi.spyOn(paypal, 'verifyWebhookSignature').mockResolvedValue(false);
    const failuresSpy = vi.spyOn(failures, 'handlePaymentFailed');

    // Call webhook API logic
    const { POST } = await import('@/app/api/paypal/webhook/route');
    
    const request = new Request('http://localhost/api/paypal/webhook', {
      method: 'POST',
      headers: {
        'paypal-transmission-id': 'invalid'
      },
      body: JSON.stringify({ 
        event_type: 'PAYMENT.CAPTURE.DENIED', 
        resource: { id: 'INVALID_ORDER', links: [{ rel: 'up', href: '/INVALID_ORDER' }] } 
      })
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid signature');

    // Verify handlePaymentFailed was not triggered effectively
    const count = db.prepare("SELECT COUNT(*) as c FROM billing_events WHERE paypal_order_id = 'INVALID_ORDER'").get() as any;
    expect(count.c).toBe(0);
    // And the function itself was never invoked
    expect(failuresSpy).not.toHaveBeenCalled();
  });
});

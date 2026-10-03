import crypto from 'crypto';

let cachedAccessToken: string | null = null;
let tokenExpiryTime: number = 0;

export async function getAccessToken(): Promise<string> {
  const baseURL = process.env.PAYPAL_BASE_URL;
  if (!baseURL || baseURL !== 'https://api-m.sandbox.paypal.com') {
    throw new Error('PAYPAL_BASE_URL must be set to https://api-m.sandbox.paypal.com for Phase 1');
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    throw new Error('Missing PayPal credentials');
  }

  // Use cached token if valid (with 30s buffer)
  if (cachedAccessToken && Date.now() < tokenExpiryTime - 30000) {
    return cachedAccessToken;
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  const response = await fetch(`${baseURL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get access token: ${error}`);
  }

  const data = await response.json();
  cachedAccessToken = data.access_token;
  tokenExpiryTime = Date.now() + (data.expires_in * 1000);
  
  return cachedAccessToken!;
}

export async function createOrder(amountCents: number, currency: string = 'USD', referenceId?: string) {
  const baseURL = process.env.PAYPAL_BASE_URL;
  const accessToken = await getAccessToken();
  const value = (amountCents / 100).toFixed(2);
  const requestId = crypto.randomUUID();

  const payload = {
    intent: 'CAPTURE',
    payment_source: {
      paypal: {
        experience_context: {
          return_url: 'http://localhost:3000/return', // placeholder
          cancel_url: 'http://localhost:3000/cancel', // placeholder
          user_action: 'PAY_NOW'
        }
      }
    },
    purchase_units: [
      {
        ...(referenceId ? { reference_id: referenceId } : {}),
        amount: {
          currency_code: currency,
          value: value
        }
      }
    ]
  };

  const response = await fetch(`${baseURL}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'PayPal-Request-Id': requestId
    },
    body: JSON.stringify(payload)
  });

  const responseBody = await response.json();

  if (!response.ok) {
    throw new Error(`Failed to create order: ${JSON.stringify(responseBody)}`);
  }

  return responseBody;
}

export async function captureOrder(orderId: string, options?: { forceDecline?: boolean }) {
  const baseURL = process.env.PAYPAL_BASE_URL;
  const accessToken = await getAccessToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };

  if (options?.forceDecline) {
    headers['PayPal-Mock-Response'] = JSON.stringify({ mock_application_codes: 'INSTRUMENT_DECLINED' });
  }

  const response = await fetch(`${baseURL}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers
  });

  // Since we expect a 422 for negative testing, we don't throw on !response.ok automatically
  // We return both status and body so callers can assert on it.
  const responseBody = await response.json().catch(() => null);

  return {
    status: response.status,
    body: responseBody
  };
}

export async function verifyWebhookSignature(headers: Record<string, string>, rawBody: string) {
  const baseURL = process.env.PAYPAL_BASE_URL;
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  const accessToken = await getAccessToken();

  if (!webhookId) {
    throw new Error('PAYPAL_WEBHOOK_ID is not configured');
  }

  const payload = {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: webhookId,
    webhook_event: JSON.parse(rawBody)
  };

  const response = await fetch(`${baseURL}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => null);
  
  if (!response.ok || body?.verification_status !== 'SUCCESS') {
    return false;
  }
  
  return true;
}

export async function getOrder(orderId: string) {
  const baseURL = process.env.PAYPAL_BASE_URL;
  const accessToken = await getAccessToken();
  const response = await fetch(`${baseURL}/v2/checkout/orders/${orderId}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error(`Failed to get order: ${await response.text()}`);
  return response.json();
}

if (process.env.NODE_ENV !== 'test' && process.env.PAYPAL_BASE_URL !== 'https://api-m.sandbox.paypal.com') {
  throw new Error('PAYPAL_BASE_URL must be set to https://api-m.sandbox.paypal.com for Phase 1');
}

# PayPal Checkout v6 & Orders v2 Integration Review (`docs/PAYPAL_REVIEW.md`)

This document reviews ChurnRescue AI's PayPal Sandbox integration across [`src/lib/paypal.ts`](../src/lib/paypal.ts), [`src/lib/agent/tools.ts`](../src/lib/agent/tools.ts), [`src/app/api/agent/create-paypal-order/route.ts`](../src/app/api/agent/create-paypal-order/route.ts), [`src/app/api/offers/[offerId]/capture/route.ts`](../src/app/api/offers/[offerId]/capture/route.ts), and [`src/components/ChatWidget.tsx`](../src/components/ChatWidget.tsx).

---

## 1. Sandbox-Only Enforcement (`assertSandbox`)

- **Implementation:** [`src/lib/paypal.ts`](../src/lib/paypal.ts) (`assertSandbox()`) and [`src/lib/config.ts`](../src/lib/config.ts) (`SANDBOX_PAYPAL_URL`).
- **Invariant:** `PAYPAL_BASE_URL` must equal `https://api-m.sandbox.paypal.com`. Any attempt to call `getAccessToken()` with a live PayPal URL or missing sandbox URL throws immediately before any network call.

---

## 2. OAuth2 Token Caching with Expiry Buffer

- **Implementation:** [`src/lib/paypal.ts`](../src/lib/paypal.ts) (`getAccessToken()`).
- **Mechanism:** Exchanges `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` via `POST /v1/oauth2/token` (`grant_type=client_credentials`), caches `access_token` in memory, and refreshes when `Date.now() >= tokenExpiryTime - 30000` (30-second safety buffer before expiration).
- **Security:** `PAYPAL_CLIENT_SECRET` and `access_token` are strictly server-only and are never returned to the client or logged.

---

## 3. Server-Side Orders v2 Creation & Idempotency (`D4`)

- **Implementation:** [`src/lib/agent/tools.ts`](../src/lib/agent/tools.ts) (`createOrderInternal(offerId)`) and [`src/lib/paypal.ts`](../src/lib/paypal.ts) (`createOrder()`).
- **Atomic Claim (`D4`):** Before calling PayPal, `createOrderInternal` executes an atomic SQLite claim:
  ```sql
  UPDATE offers
  SET order_claimed_at = ?
  WHERE id = ?
    AND (paypal_order_id IS NULL OR paypal_order_status = 'declined')
    AND (order_claimed_at IS NULL OR order_claimed_at < ?)
  ```
  - Stale claims older than `ORDER_CLAIM_STALE_MS` (5 minutes) can be reclaimed if a process crashed mid-flight.
  - Concurrent callers that lose the race poll the database for up to 500ms and return the winning `paypal_order_id` without issuing a duplicate PayPal API call.
- **PayPal-Request-Id Header:** Every `POST /v2/checkout/orders` call sends `'PayPal-Request-Id': 'offer_' + offerId` (or a new suffix after a declined capture retry, `D7`).
- **Dynamic Return/Cancel URLs:** `return_url` and `cancel_url` in `experience_context` are derived dynamically via `resolveAppBaseUrl(requestOrigin)` (`${appBaseUrl}/return` and `${appBaseUrl}/cancel`) from `APP_BASE_URL` or request origin—never hardcoded to `localhost` or `example.com`.

---

## 4. Pre-Capture Order Verification & Atomic Capture (`D1`, `D2`, `D7`)

- **Implementation:** [`src/app/api/offers/[offerId]/capture/route.ts`](../src/app/api/offers/[offerId]/capture/route.ts).
- **Sample Isolation:** Offers with `is_sample = 1` are immediately rejected with HTTP `400 {"error": "sample_offer_not_capturable"}`.
- **Pre-Capture Verification:**
  1. Verifies the `offerId` exists, belongs to the customer, is not `superseded` or `declined`, and matches the stored `paypal_order_id`.
  2. Calls `getOrder(orderId)` (`GET /v2/checkout/orders/${orderId}`) before capture to verify PayPal's authoritative `purchase_units[0].amount.value` and `currency_code === 'USD'` match `offer.amount_cents` exactly. Any client-supplied amount in the request body or query string is ignored.
- **Post-Capture Verification & Reconciliation:**
  1. Calls `captureOrder(orderId)` (`POST /v2/checkout/orders/${orderId}/capture`).
  2. Handles `422 INSTRUMENT_DECLINED` by marking `paypal_order_status = 'declined'` and creating a replacement offer at the **same** `ladder_step` and `amount_cents` (`D7`), without exposing raw PayPal error bodies.
  3. Verifies `COMPLETED` status and captured unit amount in cents (`capturedCents === offer.amount_cents`).
  4. Atomically updates `offers.status = 'captured'`, `billing_events.status = 'recovered'`, `customers.status = 'recovered'`, and inserts a single row into `recoveries`.
  5. If a network drop occurs *after* PayPal captured the order, a subsequent retry inspects `getOrder(orderId)`, detects `status === 'COMPLETED'`, and reconciles the database without calling `/capture` a second time.

---

## 5. Webhook Signature Verification

- **Implementation:** [`src/lib/paypal.ts`](../src/lib/paypal.ts) (`verifyWebhookSignature`) and [`src/app/api/webhooks/paypal/route.ts`](../src/app/api/webhooks/paypal/route.ts).
- **Mechanism:** Verifies `paypal-auth-algo`, `paypal-cert-url`, `paypal-transmission-id`, `paypal-transmission-sig`, `paypal-transmission-time`, and `PAYPAL_WEBHOOK_ID` against PayPal's `POST /v1/notifications/verify-webhook-signature` endpoint and requires `verification_status === 'SUCCESS'`.

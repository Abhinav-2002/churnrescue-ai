/**
 * ChurnRescue AI — Automated Post-Deploy Smoke Verification Script (`scripts/smoke.ts`)
 *
 * Usage:
 *   SMOKE_BASE_URL=http://localhost:3000 npx tsx scripts/smoke.ts
 *
 * Verifies:
 *   1. GET /api/health -> 200 { status: 'ok' }
 *   2. GET /api/ready  -> 200 { status: 'ready', db: 'ok', config: 'ok' }
 *   3. GET /api/debug  -> 404
 *   4. GET /api/config -> 200 { paypalClientId, environment: 'sandbox' } (zero secrets)
 *   5. GET /api/dashboard/metrics?days=14 -> 200, zero PII/emails/orderIds, 100% policy compliance, monotonic funnel, security headers
 *   6. Isolated end-to-end recovery flow on customer c_5 (simulate-failure -> start -> pause request -> confirm-pause -> reset-customer)
 *      without altering other customers (such as Hannah c_8 or Diana c_4).
 */

const BASE_URL = (process.env.SMOKE_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const TEST_CUSTOMER_ID = process.env.SMOKE_CUSTOMER_ID || 'c_5';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[SMOKE FAIL] ${message}`);
  }
}

async function runSmoke() {
  console.log(`[SMOKE] Target: ${BASE_URL}`);

  // 1. /api/health
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  assert(healthRes.status === 200, `/api/health expected 200, got ${healthRes.status}`);
  const healthJson = await healthRes.json();
  assert(healthJson.status === 'ok', `/api/health status expected 'ok', got ${healthJson.status}`);
  console.log(`[PASS] 1. GET /api/health -> 200 (status=${healthJson.status}, uptime_s=${healthJson.uptime_s})`);

  // 2. /api/ready
  const readyRes = await fetch(`${BASE_URL}/api/ready`);
  assert(readyRes.status === 200, `/api/ready expected 200, got ${readyRes.status}`);
  const readyJson = await readyRes.json();
  assert(readyJson.status === 'ready' && readyJson.db === 'ok' && readyJson.config === 'ok', `/api/ready unexpected body: ${JSON.stringify(readyJson)}`);
  console.log(`[PASS] 2. GET /api/ready  -> 200 (db=${readyJson.db}, config=${readyJson.config})`);

  // 3. /api/debug -> 404
  const debugRes = await fetch(`${BASE_URL}/api/debug`);
  assert(debugRes.status === 404, `/api/debug expected 404, got ${debugRes.status}`);
  console.log(`[PASS] 3. GET /api/debug  -> 404 (debug surface disabled)`);

  // 4. /api/config
  const configRes = await fetch(`${BASE_URL}/api/config`);
  assert(configRes.status === 200, `/api/config expected 200, got ${configRes.status}`);
  const configJson = await configRes.json();
  assert(configJson.environment === 'sandbox', `/api/config environment expected 'sandbox'`);
  assert(typeof configJson.paypalClientId === 'string' && configJson.paypalClientId.length > 0, `/api/config missing paypalClientId`);
  assert(!('paypalClientSecret' in configJson) && !('PAYPAL_CLIENT_SECRET' in configJson), `/api/config leaked secret key`);
  console.log(`[PASS] 4. GET /api/config -> 200 (environment=${configJson.environment}, clientId present)`);

  // 5. /api/dashboard/metrics?days=14 + Security Headers
  const metricsRes = await fetch(`${BASE_URL}/api/dashboard/metrics?days=14`);
  assert(metricsRes.status === 200, `/api/dashboard/metrics expected 200, got ${metricsRes.status}`);
  const nosniff = metricsRes.headers.get('x-content-type-options');
  const cspReportOnly = metricsRes.headers.get('content-security-policy-report-only');
  assert(nosniff === 'nosniff', `Expected x-content-type-options: nosniff, got ${nosniff}`);
  assert(cspReportOnly && cspReportOnly.includes('paypal.com'), `Expected Content-Security-Policy-Report-Only with paypal.com`);

  const metricsText = await metricsRes.text();
  assert(!/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(metricsText), `Metrics payload leaked an email address`);
  assert(!metricsText.includes('paypal_order_id'), `Metrics payload leaked paypal_order_id`);

  const metricsJson = JSON.parse(metricsText);
  assert(metricsJson.policy_audit.outside_policy_count === 0, `Expected 0 outside_policy_count, got ${metricsJson.policy_audit.outside_policy_count}`);
  assert(metricsJson.funnel.data_inconsistencies === 0, `Expected 0 data_inconsistencies, got ${metricsJson.funnel.data_inconsistencies}`);
  assert(
    metricsJson.funnel.failed >= metricsJson.funnel.offered &&
      metricsJson.funnel.offered >= metricsJson.funnel.accepted &&
      metricsJson.funnel.accepted >= metricsJson.funnel.paid,
    `Funnel monotonicity violated: ${JSON.stringify(metricsJson.funnel)}`
  );
  console.log(
    `[PASS] 5. GET /api/dashboard/metrics?days=14 -> 200 (outside_policy=0, inconsistencies=0, nosniff+CSP verified)`
  );

  // 6. Isolated per-customer flow on TEST_CUSTOMER_ID (c_5)
  const resetBefore = await fetch(`${BASE_URL}/api/demo/reset-customer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId: TEST_CUSTOMER_ID }),
  });
  assert(resetBefore.status === 200, `reset-customer before failed with ${resetBefore.status}`);

  try {
    const simRes = await fetch(`${BASE_URL}/api/simulate-failure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: TEST_CUSTOMER_ID }),
    });
    assert(simRes.status === 200, `simulate-failure expected 200, got ${simRes.status}`);

    const startRes = await fetch(`${BASE_URL}/api/agent/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: TEST_CUSTOMER_ID }),
    });
    assert(startRes.status === 200, `agent/start expected 200, got ${startRes.status}`);
    const startJson = await startRes.json();
    assert(typeof startJson.reply === 'string' && startJson.reply.includes('$20.00'), `Expected $20.00 initial offer for ${TEST_CUSTOMER_ID}, got: ${startJson.reply}`);

    const msgRes = await fetch(`${BASE_URL}/api/agent/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: TEST_CUSTOMER_ID, text: 'Can I pause my subscription for a month?' }),
    });
    assert(msgRes.status === 200, `agent/message expected 200, got ${msgRes.status}`);
    const msgJson = await msgRes.json();
    assert(msgJson.nextStep === 'confirm_pause', `Expected nextStep='confirm_pause', got ${msgJson.nextStep}`);

    const confirmRes = await fetch(`${BASE_URL}/api/agent/confirm-pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: TEST_CUSTOMER_ID }),
    });
    assert(confirmRes.status === 200, `agent/confirm-pause expected 200, got ${confirmRes.status}`);
    const confirmJson = await confirmRes.json();
    assert(confirmJson.success === true, `Expected confirmJson.success=true, got ${JSON.stringify(confirmJson)}`);

    const stateRes = await fetch(`${BASE_URL}/api/agent/state?customerId=${TEST_CUSTOMER_ID}`);
    assert(stateRes.status === 200, `agent/state expected 200, got ${stateRes.status}`);
    const stateJson = await stateRes.json();
    assert(stateJson.customer?.status === 'paused', `Expected customer.status='paused', got ${stateJson.customer?.status}`);
    console.log(`[PASS] 6. Isolated E2E flow on ${TEST_CUSTOMER_ID} -> simulate-failure -> $20.00 offer -> confirm_pause -> paused`);
  } finally {
    // Always restore TEST_CUSTOMER_ID to seed healthy state so existing database records are untouched
    const resetAfter = await fetch(`${BASE_URL}/api/demo/reset-customer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: TEST_CUSTOMER_ID }),
    });
    assert(resetAfter.status === 200, `reset-customer cleanup failed with ${resetAfter.status}`);
    console.log(`[PASS] 7. Restored ${TEST_CUSTOMER_ID} via POST /api/demo/reset-customer`);
  }

  console.log(`[SMOKE SUCCESS] All 7 smoke gates passed against ${BASE_URL}`);
}

runSmoke().catch((err) => {
  console.error(err);
  process.exit(1);
});

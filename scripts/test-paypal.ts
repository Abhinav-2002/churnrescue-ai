import * as dotenv from 'dotenv';
import { createOrder, captureOrder } from '../src/lib/paypal';

dotenv.config();

function redactLog(data: any): any {
  if (typeof data === 'string') {
    return data
      .replace(new RegExp(process.env.PAYPAL_CLIENT_ID || 'dummy', 'g'), '[REDACTED_CLIENT_ID]')
      .replace(new RegExp(process.env.PAYPAL_CLIENT_SECRET || 'dummy', 'g'), '[REDACTED_CLIENT_SECRET]');
  }
  if (typeof data === 'object' && data !== null) {
    const redacted = { ...data };
    for (const key in redacted) {
      if (typeof redacted[key] === 'string') {
        redacted[key] = redactLog(redacted[key]);
      } else if (typeof redacted[key] === 'object') {
        redacted[key] = redactLog(redacted[key]);
      }
    }
    return redacted;
  }
  return data;
}

const originalConsoleLog = console.log;
console.log = (...args: any[]) => {
  const redactedArgs = args.map(arg => redactLog(arg));
  originalConsoleLog(...redactedArgs);
};

const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  const redactedArgs = args.map(arg => redactLog(arg));
  originalConsoleError(...redactedArgs);
};

async function run() {
  const args = process.argv.slice(2);
  const captureMode = args.findIndex(arg => arg === '--capture');
  
  if (captureMode !== -1 && args[captureMode + 1]) {
    const orderId = args[captureMode + 1];
    console.log(`\n--- Manual Capture for Order ${orderId} ---`);
    const { status, body } = await captureOrder(orderId);
    console.log(`Status: ${status}`);
    console.log('Body:', JSON.stringify(body, null, 2));
    return;
  }

  console.log('\n--- 1. Creating $50.00 Order for Decline Test ---');
  const orderDecline = await createOrder(5000);
  console.log(`Created Order ID: ${orderDecline.id}`);
  
  console.log(`\n--- 2. Capturing $50.00 Order with forceDecline ---`);
  const { status: declineStatus, body: declineBody } = await captureOrder(orderDecline.id, { forceDecline: true });
  console.log(`Status: ${declineStatus}`);
  console.log('Body:', JSON.stringify(declineBody, null, 2));
  
  if (declineStatus !== 422) {
    console.error('Expected HTTP 422 for mocked decline');
    process.exit(1);
  }
  
  const issue = declineBody?.details?.[0]?.issue;
  if (issue !== 'INSTRUMENT_DECLINED') {
    console.error(`Expected details[0].issue === 'INSTRUMENT_DECLINED', got '${issue}'`);
    process.exit(1);
  }
  
  console.log('✅ Decline test passed!');

  console.log('\n--- 3. Creating $25.00 Order for Happy Path ---');
  const orderHappy = await createOrder(2500);
  console.log(`Created Order ID: ${orderHappy.id}`);
  console.log('Full links array:', JSON.stringify(orderHappy.links, null, 2));
  
  const payerActionLink = orderHappy.links.find((l: any) => l.rel === 'payer-action');
  const approveLink = orderHappy.links.find((l: any) => l.rel === 'approve');
  
  if (payerActionLink) {
    console.log(`\nFound 'payer-action' link: ${payerActionLink.href}`);
  } else if (approveLink) {
    console.log(`\nFound 'approve' link: ${approveLink.href}`);
  } else {
    console.log('\nNo payer-action or approve link found.');
  }
  
  console.log(`\n👉 To test the happy path:
1. Open the link above in an incognito window.
2. Log in with a sandbox PERSONAL account.
3. Complete the checkout (it will redirect to localhost).
4. Run this script again with: npx tsx scripts/test-paypal.ts --capture ${orderHappy.id}`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

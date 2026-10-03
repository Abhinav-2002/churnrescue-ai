import 'dotenv/config';
import { captureOrder } from '../src/lib/paypal';

async function main() {
  const orderId = '36G39009939523837';
  console.log(`Attempting to capture order: ${orderId}`);
  
  try {
    const result = await captureOrder(orderId);
    console.log('Capture Result:');
    console.log(JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error('Capture failed:', err.message || err);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });

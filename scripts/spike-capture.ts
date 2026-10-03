import 'dotenv/config';
import { captureOrder } from '../src/lib/paypal';

async function getOrder(orderId: string) {
    const auth = Buffer.from(process.env.PAYPAL_CLIENT_ID + ':' + process.env.PAYPAL_CLIENT_SECRET).toString('base64');
    const tokenRes = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + auth,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });
    const tokenJson = await tokenRes.json();

    const orderRes = await fetch('https://api-m.sandbox.paypal.com/v2/checkout/orders/' + orderId, {
        headers: {
            'Authorization': 'Bearer ' + tokenJson.access_token
        }
    });
    return await orderRes.json();
}

async function main() {
    const orderId = process.argv[2];
    if (!orderId) {
        console.error("Please provide an order ID as the first argument.");
        process.exit(1);
    }
    
    console.log(`Checking status of order ${orderId} before capture...`);
    const beforeOrder = await getOrder(orderId);
    console.log(`Status before capture: ${beforeOrder.status}`);

    console.log(`\nCapturing order ${orderId}...`);
    try {
        const result = await captureOrder(orderId);
        console.log('\nCapture Result:');
        console.log(JSON.stringify(result, null, 2));
    } catch (err: any) {
        console.error('\nCapture failed:', err.message || err);
    }
}

main().catch(console.error);

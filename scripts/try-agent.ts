import { POST } from '../src/app/api/agent/message/route';
import { getDb, seedDb } from '../src/lib/db';
import 'dotenv/config';

process.env.LLM_MODEL = 'gemini-3.5-flash-lite';
process.env.GOOGLE_CLOUD_LOCATION = 'global';

async function main() {
  const db = getDb();
  db.exec('DELETE FROM agent_actions; DELETE FROM conversations; DELETE FROM recoveries; DELETE FROM offers; DELETE FROM billing_events; DELETE FROM customers;');
  seedDb();
  
  const customerId = 'c_4';
  db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('at_risk', customerId);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) as any;
  db.prepare('INSERT INTO billing_events (id, customer_id, type, amount_cents, status) VALUES (?, ?, ?, ?, ?)').run(`evt_${customerId}`, customerId, 'renewal', customer.plan_price_cents, 'failed');
  
  const queries = ["My payment failed. Can I get a discount?", "ok, yes"];
  for (const query of queries) {
    console.log(`\nInput: "${query}"`);
    
    const req = {
      json: async () => ({ customerId, text: query }),
      headers: new Headers({ 'x-forwarded-for': '127.0.0.1' })
    } as any;
    
    const res = await POST(req);
    const json = await res.json();
    console.log("API Response:", json);
    
    const offer = db.prepare('SELECT * FROM offers WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1').get(customerId) as any;
    
    console.log(`Reply: ${json.reply}`);
    console.log(`NextStep: ${json.nextStep}`);
    console.log(`Offer row: ${JSON.stringify(offer)}`);
    console.log(`Order ID: ${json.orderId || 'none'}`);
    
    if (json.orderId) {
      console.log('\nCalling PayPal get_order via API...');
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
      
      const orderRes = await fetch('https://api-m.sandbox.paypal.com/v2/checkout/orders/' + json.orderId, {
        headers: {
          'Authorization': 'Bearer ' + tokenJson.access_token
        }
      });
      const orderData = await orderRes.json();
      const amountValue = parseFloat(orderData.purchase_units[0].amount.value);
      console.log('PayPal Order Amount: ' + amountValue);
      console.log('Offer Amount: ' + (offer.amount_cents / 100));
      if (amountValue === (offer.amount_cents / 100)) {
        console.log('Assertion PASSED: Order amount equals offer amount.');
      } else {
        console.log('Assertion FAILED!');
      }
    }
  }
}

main().catch(console.error);
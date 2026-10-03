import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getDb } from '../db';
import { centsToDollarString } from '../money';
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/langchain';
import 'dotenv/config';

// Initialize the real toolkit for internal use (sandbox only)
const toolkit = new PayPalAgentToolkit({
  clientId: process.env.PAYPAL_CLIENT_ID!,
  clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
  configuration: {
    actions: { orders: { create: true } },
    context: { sandbox: true },
  },
});

const tools = toolkit.getTools();
const toolkitCreateOrder = tools.find(t => t.name === 'create_order');

export const create_recovery_order = tool(
  async (input, config) => {
    try {
      const { offerId } = input;
      // Get customerId from the graph state or config
      const customerId = config?.configurable?.customerId;
      
      const db = getDb();
      
      // Load the offer
      const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) as any;
      
      if (!offer) {
        return JSON.stringify({ error: `Offer ${offerId} not found.` });
      }
      
      // Verify it belongs to the customer
      if (customerId && offer.customer_id !== customerId) {
        return JSON.stringify({ error: 'Offer does not belong to the current customer.' });
      }
      
      // Verify it is accepted
      if (offer.status !== 'accepted') {
        return JSON.stringify({ error: `Offer must be 'accepted'. Current status: ${offer.status}` });
      }
      
      // Verify it is not expired (older than 30 minutes)
      const now = Date.now();
      const expiresAt = new Date(offer.expires_at).getTime();
      if (now > expiresAt) {
        return JSON.stringify({ error: 'Offer has expired (older than 30 minutes).' });
      }
      
      // If it has an order id and it wasn't declined, return it
      if (offer.paypal_order_id && offer.paypal_order_status !== 'declined') {
        db.prepare(`
          INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          `act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          offer.customer_id,
          offer.billing_event_id,
          'create_recovery_order_reused',
          'Returned existing non-declined order',
          JSON.stringify({ orderId: offer.paypal_order_id, status: offer.paypal_order_status })
        );

        return JSON.stringify({
          orderId: offer.paypal_order_id,
          status: offer.paypal_order_status,
          approveUrl: offer.paypal_approve_url,
          note: 'Returned existing order'
        });
      }
      
      // Otherwise build the items array from the offer's server-side amount
      const dollarAmount = centsToDollarString(offer.amount_cents);
      const toolkitInput = {
        currencyCode: 'USD',
        items: [{
          name: 'Plan recovery',
          quantity: 1,
          itemCost: Number(dollarAmount), // Using Number because toolkit expects number
          itemTotal: Number(dollarAmount)
        }],
        returnUrl: 'https://example.com/return',
        cancelUrl: 'https://example.com/cancel'
      };
      
      if (!toolkitCreateOrder) {
        throw new Error('Real create_order tool not found in toolkit.');
      }
      
      // Call the toolkit's real create_order directly
      const resultRaw = await toolkitCreateOrder.invoke(toolkitInput);
      
      let resultStr = typeof resultRaw === 'string' ? resultRaw : JSON.stringify(resultRaw);
      
      let parsedResult: any = {};
      try {
        parsedResult = JSON.parse(resultStr);
      } catch (e) {
        parsedResult = { raw: resultStr };
      }
      
      const paypalOrderId = parsedResult.id;
      const approveLink = parsedResult.links?.find((l: any) => l.rel === 'approve' || l.rel === 'payer-action')?.href;
      
      if (paypalOrderId) {
        // Save paypal_order_id on the offer
        db.prepare(`
          UPDATE offers 
          SET paypal_order_id = ?, paypal_order_status = 'created', paypal_approve_url = ?
          WHERE id = ?
        `).run(paypalOrderId, approveLink || null, offerId);
        
        // Log the call in agent_actions
        db.prepare(`
          INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          `act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          offer.customer_id,
          offer.billing_event_id,
          'create_recovery_order',
          `Created PayPal order ${paypalOrderId} for offer ${offerId}`,
          JSON.stringify({ paypalOrderId, amount_cents: offer.amount_cents, result: parsedResult })
        );
      } else {
        db.prepare(`
          INSERT INTO agent_actions (id, customer_id, billing_event_id, action, reasoning, details_json)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          `act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          offer.customer_id,
          offer.billing_event_id,
          'create_recovery_order_failed',
          'Failed to extract order ID from toolkit response',
          JSON.stringify({ resultStr })
        );
      }
      
      return JSON.stringify(parsedResult);
      
    } catch (error: any) {
      return JSON.stringify({ error: error.message || String(error) });
    }
  },
  {
    name: 'create_recovery_order',
    description: 'Creates a PayPal checkout order for the customer\'s accepted offer.',
    schema: z.object({ offerId: z.string().describe('The ID of the accepted offer') })
  }
);

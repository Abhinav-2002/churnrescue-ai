import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getDb } from '../db';
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/langchain';
import { centsToDollarString } from '../money';
import 'dotenv/config';

const toolkit = new PayPalAgentToolkit({
  clientId: process.env.PAYPAL_CLIENT_ID!,
  clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
  configuration: {
    actions: { orders: { create: true } },
    context: { sandbox: true },
  },
});
const toolkitCreateOrder = toolkit.getTools().find((t: any) => t.name === 'create_order')!;

export const create_recovery_order = tool(
  async ({ offerId }, config) => {
    const db = getDb();
    const customerId = config?.configurable?.customerId;
    
    if (!customerId) return JSON.stringify({ error: 'No customerId in context' });
    
    const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) as any;
    if (!offer) return JSON.stringify({ error: 'Offer not found' });
    if (offer.customer_id !== customerId) return JSON.stringify({ error: 'Unauthorized offer access' });
    if (offer.status !== 'accepted') return JSON.stringify({ error: 'Offer is not accepted' });
    
    const expiresAt = new Date(offer.expires_at).getTime();
    if (Date.now() > expiresAt) return JSON.stringify({ error: 'Offer has expired' });
    
    if (offer.paypal_order_id && offer.paypal_order_status !== 'declined') {
      return JSON.stringify({
        orderId: offer.paypal_order_id,
        status: offer.paypal_order_status
      });
    }

    try {
      const toolkitInput = {
        currencyCode: 'USD',
        items: [{
          name: 'Plan recovery',
          quantity: 1,
          itemCost: Number(centsToDollarString(offer.amount_cents)),
          itemTotal: Number(centsToDollarString(offer.amount_cents))
        }],
        returnUrl: 'https://example.com/return',
        cancelUrl: 'https://example.com/cancel'
      };
      
      const resRaw = await toolkitCreateOrder.invoke(toolkitInput);
      const resString = typeof resRaw === 'string' ? resRaw : JSON.stringify(resRaw);
      const res = JSON.parse(resString);
      
      const orderId = res.id;
      db.prepare('UPDATE offers SET paypal_order_id = ?, paypal_order_status = ? WHERE id = ?').run(
        orderId, res.status ? res.status.toLowerCase() : 'created', offerId
      );
      
      return JSON.stringify({ orderId, status: res.status });
    } catch (e: any) {
      return JSON.stringify({ error: e.message });
    }
  },
  {
    name: 'create_recovery_order',
    description: 'Creates a PayPal checkout order for a successfully accepted offer.',
    schema: z.object({
      offerId: z.string().describe('The ID of the accepted offer in the database'),
    }),
  }
);

export async function createOrderInternal(offerId: string) {
  const db = getDb();
  const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) as any;
  if (!offer) return;
  if (offer.status !== 'accepted') return;
  if (offer.paypal_order_id && offer.paypal_order_status !== 'declined') return offer.paypal_order_id;
  
  try {
    const toolkitInput = {
      currencyCode: 'USD',
      items: [{
        name: 'Plan recovery',
        quantity: 1,
        itemCost: Number(centsToDollarString(offer.amount_cents)),
        itemTotal: Number(centsToDollarString(offer.amount_cents))
      }],
      returnUrl: 'https://example.com/return',
      cancelUrl: 'https://example.com/cancel'
    };
    const resRaw = await toolkitCreateOrder.invoke(toolkitInput);
    const resString = typeof resRaw === 'string' ? resRaw : JSON.stringify(resRaw);
    const res = JSON.parse(resString);
    const status = res.status ? res.status.toLowerCase() : 'created';
        const approveLink = res.links?.find((l: any) => l.rel === 'approve' || l.rel === 'payer-action')?.href || null;
    db.prepare('UPDATE offers SET paypal_order_id = ?, paypal_order_status = ?, paypal_approve_url = ? WHERE id = ?').run(
      res.id, status, approveLink, offerId
    );
    return res.id;
  } catch (e) {
    console.error('Failed to create order internally:', e);
    return null;
  }
}

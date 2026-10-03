import { NextResponse } from 'next/server';
import { captureOrder } from '@/lib/paypal';

export async function POST(
  request: Request,
  context: any
) {
  try {
    const { forceDecline } = await request.json().catch(() => ({ forceDecline: false }));
    const { id: orderId } = await context.params;

    const { status, body } = await captureOrder(orderId, { forceDecline });
    
    return NextResponse.json(body, { status });
  } catch (error: any) {
    console.error('Capture order error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

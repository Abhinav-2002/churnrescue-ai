import { NextResponse } from 'next/server';
import { createOrder } from '@/lib/paypal';

// Phase 1 only: allow passing amount from client. This will be locked down later.
export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }
  try {
    const { amountCents } = await request.json();
    
    if (typeof amountCents !== 'number' || amountCents <= 0) {
      return NextResponse.json({ error: 'Invalid amountCents' }, { status: 400 });
    }

    const order = await createOrder(amountCents);
    return NextResponse.json(order);
  } catch (error: any) {
    console.error('Create order error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

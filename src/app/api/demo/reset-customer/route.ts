import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resetCustomer } from '@/lib/db';
import { rateLimit, LIMITS } from '@/lib/rate-limit';
import { isDemoMode } from '@/lib/demo';

const reqSchema = z.object({
  customerId: z.string().min(1),
});

export async function POST(req: Request) {
  if (!isDemoMode()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const limited = rateLimit(req, LIMITS.reset);
  if (limited) return limited;

  try {
    const rawBody = await req.json().catch(() => null);
    const parsed = reqSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_customer_id' }, { status: 400 });
    }

    const ok = resetCustomer(parsed.data.customerId);
    if (!ok) {
      return NextResponse.json({ error: 'customer_not_found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, customerId: parsed.data.customerId });
  } catch (error) {
    console.error('Failed to reset customer:', error);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

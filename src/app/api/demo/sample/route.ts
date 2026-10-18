import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadSampleHistory, clearSampleHistory } from '@/lib/db';
import { rateLimit, LIMITS } from '@/lib/rate-limit';
import { isDemoMode } from '@/lib/demo';

const reqSchema = z.object({
  action: z.enum(['load', 'clear']).optional().default('load'),
});

export async function POST(req: Request) {
  if (!isDemoMode()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const limited = rateLimit(req, LIMITS.reset);
  if (limited) return limited;

  try {
    const rawBody = await req.json().catch(() => ({}));
    const parsed = reqSchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    if (parsed.data.action === 'clear') {
      const res = clearSampleHistory();
      return NextResponse.json({ success: true, action: 'clear', deleted: res.deleted });
    }

    const res = loadSampleHistory();
    return NextResponse.json({ success: true, action: 'load', loaded: res.loaded });
  } catch (error) {
    console.error('Failed to manage sample history:', error);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

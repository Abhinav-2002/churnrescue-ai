import { NextResponse } from 'next/server';
import { resetDb } from '@/lib/db';
import { rateLimit, LIMITS } from '@/lib/rate-limit';
import { isDemoMode } from '@/lib/demo';

export async function POST(req: Request) {
  if (!isDemoMode()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  
  const limited = rateLimit(req, LIMITS.reset);
  if (limited) return limited;

  try {
    resetDb();
    return NextResponse.json({ success: true, message: 'Database reset to seed state' });
  } catch (error: any) {
    console.error('Failed to reset DB:', error);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

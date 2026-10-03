import { NextResponse } from 'next/server';
import { resetDb } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';

export async function POST(req: Request) {
  if (process.env.DEMO_MODE !== '1') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  
  const limited = rateLimit(req, 5, 60 * 1000);
  if (limited) return limited;

  try {
    resetDb();
    return NextResponse.json({ success: true, message: 'Database reset to seed state' });
  } catch (error: any) {
    console.error('Failed to reset DB:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  getDb();
  return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() });
}

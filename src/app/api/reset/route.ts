import { NextResponse } from 'next/server';
import { resetDb } from '@/lib/db';

export async function POST() {
  try {
    resetDb();
    return NextResponse.json({ success: true, message: 'Database reset to seed state' });
  } catch (error: any) {
    console.error('Failed to reset DB:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

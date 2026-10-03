import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get('customerId');

  if (!customerId) {
    return NextResponse.json({ error: 'customerId required' }, { status: 400 });
  }

  const db = getDb();
  const conversations = db.prepare(`
    SELECT * FROM conversations
    WHERE customer_id = ?
    ORDER BY created_at ASC
  `).all(customerId);

  return NextResponse.json(conversations);
}

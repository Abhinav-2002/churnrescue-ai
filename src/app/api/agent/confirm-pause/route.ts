import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const { customerId, offerId } = await req.json();
    if (!customerId || !offerId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

    const db = getDb();
    const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) as any;
    if (!offer || offer.customer_id !== customerId) return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    
    if (offer.kind !== 'pause') return NextResponse.json({ error: 'Not a pause offer' }, { status: 400 });

    db.prepare(`UPDATE offers SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP WHERE id = ?`).run(offerId);
    db.prepare(`UPDATE customers SET status = 'paused' WHERE id = ?`).run(customerId);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

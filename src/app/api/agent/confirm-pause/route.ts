import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const customerId = body?.customerId;
    let offerId = body?.offerId;
    if (!customerId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

    const db = getDb();
    if (!offerId) {
      const activePauseOffer = db.prepare(`SELECT id FROM offers WHERE customer_id = ? AND kind = 'pause' AND status IN ('pending', 'accepted') AND is_sample = 0 ORDER BY rowid DESC LIMIT 1`).get(customerId) as any;
      if (activePauseOffer) {
        offerId = activePauseOffer.id;
      }
    }
    if (!offerId) return NextResponse.json({ error: 'Offer not found' }, { status: 404 });

    const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) as any;
    if (!offer || offer.customer_id !== customerId) return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    if (offer.is_sample === 1) return NextResponse.json({ error: 'sample_offer_not_allowed' }, { status: 400 });
    
    if (offer.kind !== 'pause') return NextResponse.json({ error: 'Not a pause offer' }, { status: 400 });

    if (offer.status !== 'pending' && offer.status !== 'accepted') {
      return NextResponse.json({ error: 'Offer is not pending or accepted' }, { status: 400 });
    }

    if (new Date(offer.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'Offer expired' }, { status: 400 });
    }

    db.transaction(() => {
      db.prepare(`UPDATE offers SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP WHERE id = ?`).run(offerId);
      db.prepare(`UPDATE customers SET status = 'paused' WHERE id = ?`).run(customerId);
      db.prepare(`UPDATE billing_events SET status = 'paused' WHERE id = ?`).run(offer.billing_event_id);
    })();

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

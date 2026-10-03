import { getDb } from '@/lib/db';
import { isDemoMode } from '@/lib/demo';
import { notFound } from 'next/navigation';
import AdminClientPage from './AdminClientPage';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  if (!isDemoMode()) {
    notFound();
  }
  const db = getDb();
  
  const customers = db.prepare('SELECT * FROM customers').all() as any[];
  
  // We want to join billing_events to show the latest result, or just fetch events separately
  const events = db.prepare('SELECT * FROM billing_events ORDER BY created_at DESC').all() as any[];

  return (
    <AdminClientPage customers={customers} events={events} />
  );
}

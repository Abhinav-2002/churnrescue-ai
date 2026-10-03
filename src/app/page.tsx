import { getDb } from '@/lib/db';
import ClientPage from './ClientPage';

export const dynamic = 'force-dynamic';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>
}) {
  const db = getDb();
  
  const customers = db.prepare('SELECT * FROM customers').all() as any[];
  
  if (customers.length === 0) {
    return <div>No customers found.</div>;
  }

  const resolvedParams = await searchParams;
  const selectedCustomerId = resolvedParams.customerId || customers[0].id;
  const selectedCustomer = customers.find(c => c.id === selectedCustomerId) || customers[0];

  return (
    <ClientPage 
      customers={customers} 
      selectedCustomer={selectedCustomer} 
    />
  );
}

import { getDb } from '@/lib/db';
import { redirect } from 'next/navigation';
import ClientPage from './ClientPage';

export const dynamic = 'force-dynamic';

export default async function Page({
  searchParams,
}: {
  searchParams: { customerId?: string }
}) {
  const db = getDb();
  
  const customers = db.prepare('SELECT * FROM customers').all() as any[];
  
  if (customers.length === 0) {
    return <div>No customers found.</div>;
  }

  const selectedCustomerId = searchParams.customerId || customers[0].id;
  const selectedCustomer = customers.find(c => c.id === selectedCustomerId) || customers[0];

  // If we fell back to the first customer because the ID was invalid or missing, redirect to the clean URL
  if (!searchParams.customerId || searchParams.customerId !== selectedCustomer.id) {
    redirect(`/?customerId=${selectedCustomer.id}`);
  }

  return (
    <ClientPage 
      customers={customers} 
      selectedCustomer={selectedCustomer} 
    />
  );
}

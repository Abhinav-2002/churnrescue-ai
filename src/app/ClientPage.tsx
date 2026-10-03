'use client';

import { useRouter } from 'next/navigation';

export default function ClientPage({ customers, selectedCustomer }: { customers: any[], selectedCustomer: any }) {
  const router = useRouter();

  const handleReset = async () => {
    await fetch('/api/reset', { method: 'POST' });
    router.refresh();
  };

  const handleCustomerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    router.push(`/?customerId=${e.target.value}`);
  };

  return (
    <main className="p-8 max-w-2xl mx-auto font-sans">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">ChurnRescue AI - Demo</h1>
        <button 
          onClick={handleReset}
          className="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700"
        >
          Reset demo
        </button>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">Switch Customer</label>
        <select 
          value={selectedCustomer.id}
          onChange={handleCustomerChange}
          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
        >
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.email})
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white shadow overflow-hidden sm:rounded-lg border">
        <div className="px-4 py-5 sm:px-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900">Customer Profile</h3>
        </div>
        <div className="border-t border-gray-200">
          <dl>
            <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6 border-b">
              <dt className="text-sm font-medium text-gray-500">Name</dt>
              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{selectedCustomer.name}</dd>
            </div>
            <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6 border-b">
              <dt className="text-sm font-medium text-gray-500">Plan</dt>
              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                {selectedCustomer.plan_name} (${(selectedCustomer.plan_price_cents / 100).toFixed(2)})
              </dd>
            </div>
            <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6 border-b">
              <dt className="text-sm font-medium text-gray-500">Usage</dt>
              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{selectedCustomer.usage_percent}%</dd>
            </div>
            <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
              <dt className="text-sm font-medium text-gray-500">Status</dt>
              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2 capitalize font-semibold">
                {selectedCustomer.status}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </main>
  );
}

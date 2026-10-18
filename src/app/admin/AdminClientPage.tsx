'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useChat } from '@/components/ChatContext';

export default function AdminClientPage({ customers, events }: { customers: any[], events: any[] }) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { setCustomerId, setIsOpen, openChatForCustomer } = useChat();

  const simulateFailure = async (customerId: string) => {
    setLoadingId(customerId);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/simulate-failure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId })
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(`Error: ${data.error} (Status: ${data.status}, Issue: ${data.issue})`);
      } else {
        // Open the chat right away with fresh state
      openChatForCustomer(customerId);
      }
      router.refresh();
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoadingId(null);
    }
  };

  const handleResetCustomer = async (customerId: string) => {
    setLoadingId(`reset_${customerId}`);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/demo/reset-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(`Error resetting customer: ${data.error || res.statusText}`);
      }
      router.refresh();
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <main className="p-8 max-w-4xl mx-auto font-sans">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <p className="text-xs text-gray-500 mt-1">Demo data resets when the server restarts. Use Reset Customer on any row to reset a single customer without affecting others.</p>
        </div>
        <div className="space-x-4">
          <a href="/dashboard" className="text-blue-600 hover:underline">View Analytics Dashboard &rarr;</a>
          <button 
            onClick={async () => {
              setErrorMsg(null);
              const res = await fetch('/api/reset', { method: 'POST' });
              if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                if (data.error === 'hosted_reset_disabled') {
                  setErrorMsg('Global reset is disabled in hosted demo mode. Use the per-customer Reset button on a row instead.');
                } else {
                  setErrorMsg(`Reset error: ${data.error || res.statusText}`);
                }
                return;
              }
              router.refresh();
            }}
            className="px-4 py-2 border rounded text-gray-600 hover:bg-gray-100"
          >
            Reset Sandbox
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
          {errorMsg}
        </div>
      )}

      <div className="bg-white shadow overflow-hidden sm:rounded-lg border mb-8">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plan</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {customers.map((c) => {
              const isAtRisk = c.status === 'at_risk';
              const latestEvent = events.find(e => e.customer_id === c.id);

              return (
                <tr key={c.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{c.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{c.plan_name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${isAtRisk ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                      {c.status}
                    </span>
                    {latestEvent && latestEvent.status === 'failed' && (
                      <div className="text-xs mt-1 text-gray-400">Order: {latestEvent.paypal_order_id}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 space-x-2">
                    <button
                      onClick={() => simulateFailure(c.id)}
                      disabled={isAtRisk || loadingId === c.id}
                      className="bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      {loadingId === c.id ? 'Simulating...' : 'Simulate Failure'}
                    </button>
                    <button
                      onClick={() => openChatForCustomer(c.id)}
                      className="border border-gray-300 text-gray-700 px-3 py-1 rounded text-sm hover:bg-gray-50"
                    >
                      Open Widget
                    </button>
                    <button
                      onClick={() => handleResetCustomer(c.id)}
                      disabled={loadingId === `reset_${c.id}`}
                      data-testid={`admin-reset-${c.id}`}
                      className="border border-amber-300 text-amber-800 bg-amber-50 px-3 py-1 rounded text-sm hover:bg-amber-100 disabled:opacity-50"
                    >
                      {loadingId === `reset_${c.id}` ? 'Resetting...' : 'Reset Customer'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}

'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useMetricsPolling } from '@/lib/hooks/useMetricsPolling';
import { formatCents } from '@/lib/format';
import { DonutChart } from './DonutChart';
import { FunnelChart } from './FunnelChart';
import { LineChart } from './LineChart';

// Lightweight local icons (avoiding dependencies)
const IconTrendingUp = () => <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>;
const IconWarning = () => <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>;
const IconRefresh = () => <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><polyline points="1 4 1 10 7 10"></polyline><polyline points="23 20 23 14 17 14"></polyline><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path></svg>;

export function DashboardClient() {
  const { data, error, loading, lastUpdated, retry } = useMetricsPolling();
  const [theme, setTheme] = useState<'light'|'dark'>('light'); // Assuming system sync is handled in a global ThemeProvider, but we implement a toggle
  
  const [filterAction, setFilterAction] = useState<string | null>(null);
  const [filterStage, setFilterStage] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    try {
      if (newTheme === 'dark') document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', newTheme);
    } catch(e) {}
  };

  React.useEffect(() => {
    try {
      let currentTheme = 'light';
      if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        currentTheme = 'dark';
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      setTimeout(() => setTheme(currentTheme as 'light'|'dark'), 0);
    } catch(e) {}
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-100 p-4">
        <IconWarning />
        <h2 className="mt-4 text-xl font-medium">Connection Lost</h2>
        <p className="mt-2 text-gray-500 text-center max-w-md">We lost connection to the metrics server. The dashboard will automatically retry in the background.</p>
        <button onClick={retry} className="mt-6 px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">Try Now</button>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900" aria-label="Loading dashboard...">
        <div className="animate-spin text-blue-600"><IconRefresh /></div>
      </div>
    );
  }

  if (!data) return null;

  // Derived metrics
  const mixData = [
    { label: 'Card Swap / Retry', value: data.decisions.filter(d => d.action === 'retry').length, color: '#10b981' }, // emerald
    { label: 'Discount Applied', value: data.decisions.filter(d => d.action === 'partial_credit').length, color: '#3b82f6' }, // blue
    { label: 'Pause Account', value: data.decisions.filter(d => d.action === 'pause').length, color: '#eab308' }, // yellow
    { label: 'Human Escalation', value: data.decisions.filter(d => d.action === 'escalate').length, color: '#ef4444' } // red
  ].sort((a,b) => b.value - a.value);

  const funnelData = [
    { id: 'failed', label: 'Failed Payments', value: data.funnel.failed, color: '#ef4444' },
    { id: 'offered', label: 'Offered Intervention', value: data.funnel.offered, color: '#3b82f6' },
    { id: 'accepted', label: 'Accepted Offer', value: data.funnel.accepted, color: '#eab308' },
    { id: 'paid', label: 'Payment Successful', value: data.funnel.paid, color: '#10b981' },
  ];

  const rulesMap = {
    'escalated_by_keyword': 'Forced escalation',
    'retry_forced': 'Invalid attempt blocked',
    'ladder_limited': 'Discount capped',
    'template_used': 'Template enforced'
  };

  const guardrailsCounts = data.decisions.reduce((acc, d) => {
    if (d.guardrail_category) {
      acc[d.guardrail_category] = (acc[d.guardrail_category] || 0) + 1;
      acc.total = (acc.total || 0) + 1;
    }
    return acc;
  }, {} as any);

  const latestClamped = data.decisions.find(d => d.guardrail_category === 'ladder_limited' && d.proposed_discount_percent && d.approved_discount_percent);
  
  const humansNeeded = data.customers.filter(c => c.last_action === 'escalate' || c.status === 'at_risk');

  const filteredCustomers = data.customers.filter(c => {
    if (filterAction) {
      if (filterAction === 'Card Swap / Retry' && c.last_action !== 'retry') return false;
      if (filterAction === 'Discount Applied' && c.last_action !== 'partial_credit') return false;
      if (filterAction === 'Pause Account' && c.last_action !== 'pause') return false;
      if (filterAction === 'Human Escalation' && c.last_action !== 'escalate') return false;
    }
    if (filterStage) {
      if (filterStage === 'failed' && c.status !== 'failed' && c.status !== 'at_risk') return false;
      if (filterStage === 'paid' && c.status !== 'recovered') return false;
      if (filterStage === 'accepted' && c.status !== 'recovered' && c.status !== 'paused') return false;
      // "offered" stage is broader, skip strict mapping for demo simplicity or use last_action existence
      if (filterStage === 'offered' && !c.last_action) return false;
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] text-gray-800 dark:text-gray-200 font-sans transition-colors">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/80 dark:bg-[#0a0a0a]/80 backdrop-blur border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold tracking-tight">ChurnRescue AI</h1>
          <span className="px-2.5 py-0.5 bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 rounded-full text-xs font-semibold">Sandbox Demo</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Live • {lastUpdated ? lastUpdated.toLocaleTimeString() : 'Polling...'}</span>
          </div>
          <button onClick={toggleTheme} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500" aria-label="Toggle theme">
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
          <Link href="/" className="text-sm font-medium bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">Chat Demo ↗</Link>
        </div>
      </header>

      <main className="max-w-[1920px] mx-auto p-4 md:p-6 lg:p-8 space-y-6">
        
        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-sm">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-2">Recovered Revenue</div>
            <div className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{formatCents(data.kpis.total_recovered)}</div>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-sm">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-2">Recovery Rate</div>
            <div className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{(data.kpis.recovery_rate * 100).toFixed(0)}%</div>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-sm">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-2">Failed Payments</div>
            <div className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{formatCents(data.kpis.total_failed)}</div>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-sm">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-2">Customers Recovered</div>
            <div className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{data.funnel.paid}</div>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-orange-100 dark:border-orange-900/30 rounded-xl p-5 shadow-sm bg-orange-50/50 dark:bg-orange-900/10">
            <div className="text-sm text-orange-600 dark:text-orange-400 mb-1 flex items-center gap-2">
              <IconWarning /> Needs Human
            </div>
            <div className="text-3xl font-bold text-orange-700 dark:text-orange-300 tabular-nums">{data.kpis.escalated}</div>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-bold mb-1">Failed vs Recovered Revenue</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Daily aggregated amounts</p>
            <LineChart data={data.daily_series} />
          </div>
          
          <div className="lg:col-span-4 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-6 shadow-sm">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-lg font-bold mb-1">Intervention Mix</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Distribution of strategies</p>
              </div>
              {filterAction && (
                <button onClick={() => setFilterAction(null)} className="text-xs text-blue-600 hover:underline">Clear Filter</button>
              )}
            </div>
            <DonutChart data={mixData} onSliceClick={setFilterAction} />
          </div>
        </div>

        {/* Lower Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-6 shadow-sm">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-lg font-bold mb-1">Recovery Funnel</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Pipeline conversion</p>
              </div>
              {filterStage && (
                <button onClick={() => setFilterStage(null)} className="text-xs text-blue-600 hover:underline">Clear Filter</button>
              )}
            </div>
            <FunnelChart data={funnelData} onStageClick={setFilterStage} />
          </div>
          
          <div className="lg:col-span-4 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-6 shadow-sm flex flex-col">
            <h2 className="text-lg font-bold mb-1 flex items-center gap-2"><IconWarning /> Guardrails at Work</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">LLM constrained by deterministic rules</p>
            
            <div className="flex-1 space-y-4">
              <div className="flex justify-between items-center pb-3 border-b border-gray-100 dark:border-gray-800">
                <span className="text-sm font-medium">Total intercepts</span>
                <span className="font-bold">{guardrailsCounts.total || 0}</span>
              </div>
              {Object.entries(rulesMap).map(([key, label]) => {
                const count = guardrailsCounts[key] || 0;
                if (!count) return null;
                return (
                  <div key={key} className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">{label}</span>
                    <span className="font-medium">{count}</span>
                  </div>
                );
              })}
            </div>
            
            <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm text-gray-600 dark:text-gray-300 italic border border-gray-100 dark:border-gray-700">
              {guardrailsCounts.total || 0} proposals adjusted by code before reaching customers.
              {latestClamped && (
                <div className="mt-2 font-medium text-blue-700 dark:text-blue-400 not-italic">
                  Latest: Model proposed {latestClamped.proposed_discount_percent}%, code allowed {latestClamped.approved_discount_percent}%.
                </div>
              )}
            </div>
          </div>
          
          <div className="lg:col-span-4 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-6 shadow-sm overflow-hidden flex flex-col">
            <h2 className="text-lg font-bold mb-1 text-orange-600 dark:text-orange-400">Needs a Human Queue <span className="bg-orange-100 text-orange-800 text-xs px-2 py-0.5 rounded-full ml-2">{humansNeeded.length}</span></h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Escalated customers</p>
            
            <div className="overflow-y-auto flex-1 pr-2 space-y-3">
              {humansNeeded.length === 0 ? (
                <div className="text-center text-gray-400 py-8 text-sm">Queue is empty</div>
              ) : humansNeeded.map(c => (
                <div key={c.id} className="flex items-center justify-between p-3 border border-gray-100 dark:border-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  <div>
                    <div className="font-medium text-sm">{c.name}</div>
                    <div className="text-xs text-gray-500 mt-1">{c.plan} • {c.status}</div>
                  </div>
                  <button onClick={() => setSelectedCustomerId(c.id)} className="text-xs font-medium text-blue-600 hover:underline">Review</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-6 shadow-sm overflow-x-auto">
          <div className="flex justify-between items-center mb-6 min-w-[800px]">
            <h2 className="text-lg font-bold">Customers</h2>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">Filter:</span>
              <select 
                value={filterAction || ''} 
                onChange={(e) => setFilterAction(e.target.value || null)}
                className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Interventions</option>
                <option value="Card Swap / Retry">Card Swap / Retry</option>
                <option value="Discount Applied">Discount Applied</option>
                <option value="Pause Account">Pause Account</option>
                <option value="Human Escalation">Human Escalation</option>
              </select>
            </div>
          </div>

          <table className="w-full text-left text-sm min-w-[800px]">
            <thead className="text-gray-500 dark:text-gray-400 font-medium border-b border-gray-100 dark:border-gray-800">
              <tr>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium">Usage</th>
                <th className="pb-3 font-medium">Customer</th>
                <th className="pb-3 font-medium">Plan</th>
                <th className="pb-3 font-medium">Last Action</th>
                <th className="pb-3 font-medium text-right">Amounts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {filteredCustomers.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-gray-400">No customers found</td></tr>
              ) : filteredCustomers.map(c => (
                <tr key={c.id} onClick={() => setSelectedCustomerId(c.id)} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer">
                  <td className="py-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                      c.status === 'recovered' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' :
                      c.status === 'failed' || c.status === 'at_risk' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                    }`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                      {c.status.replace('_', ' ').toUpperCase()}
                    </span>
                  </td>
                  <td className="py-4">
                    <div className="flex items-center gap-2">
                      <span className="w-8 tabular-nums">{c.usage_percent}%</span>
                      <div className="w-16 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div className={`h-full ${c.usage_percent > 80 ? 'bg-emerald-500' : c.usage_percent > 40 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{width: `${c.usage_percent}%`}}></div>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 font-medium text-gray-900 dark:text-white">{c.name}</td>
                  <td className="py-4 text-gray-600 dark:text-gray-400">{c.plan}</td>
                  <td className="py-4">
                    <span className="text-gray-900 dark:text-gray-100">{c.last_action ? c.last_action.replace('_', ' ') : 'None'}</span>
                    <div className="text-xs text-gray-500">{c.last_action_at ? new Date(c.last_action_at).toLocaleString() : ''}</div>
                  </td>
                  <td className="py-4 text-right">
                    <div className="tabular-nums text-gray-900 dark:text-white">{formatCents(c.price_cents)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {/* Drawer */}
      {selectedCustomerId && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm" onClick={() => setSelectedCustomerId(null)}></div>
          <div className="relative w-full max-w-md bg-white dark:bg-gray-900 h-full shadow-2xl flex flex-col transform transition-transform border-l border-gray-200 dark:border-gray-800 animate-slide-in-right">
            <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold">Decision Timeline</h3>
                <p className="text-sm text-gray-500">{data.customers.find(c => c.id === selectedCustomerId)?.name}</p>
              </div>
              <button onClick={() => setSelectedCustomerId(null)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full text-gray-500 text-xl font-medium leading-none">&times;</button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <div className="space-y-6 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 dark:before:via-slate-700 before:to-transparent">
                {data.decisions.filter(d => d.customer_id === selectedCustomerId).length === 0 ? (
                  <div className="text-center text-gray-500 py-8 relative z-10 bg-white dark:bg-gray-900">No decisions recorded yet.</div>
                ) : (
                  data.decisions.filter(d => d.customer_id === selectedCustomerId)
                    .sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                    .map((d, i) => (
                      <div key={i} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                        <div className="flex items-center justify-center w-5 h-5 rounded-full border-4 border-white dark:border-gray-900 bg-blue-500 text-slate-500 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 absolute left-0 md:left-1/2 -translate-x-1/2 z-10"></div>
                        <div className="w-[calc(100%-2.5rem)] md:w-[calc(50%-2.5rem)] ml-10 md:ml-0 p-4 rounded border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 shadow-sm">
                          <div className="flex justify-between mb-1">
                            <span className="font-bold text-gray-900 dark:text-gray-100 text-sm">{d.action.replace('_', ' ').toUpperCase()}</span>
                            <span className="text-xs text-gray-500">{new Date(d.created_at).toLocaleTimeString()}</span>
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-300">
                            {d.action === 'partial_credit' && d.proposed_discount_percent && (
                              <span>Offered {d.proposed_discount_percent}% discount.</span>
                            )}
                            {d.guardrail_category && (
                              <div className="mt-2 text-xs text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 p-2 rounded">
                                Guardrail applied: {rulesMap[d.guardrail_category as keyof typeof rulesMap] || d.guardrail_category}
                                {d.guardrail_category === 'ladder_limited' && d.approved_discount_percent !== null && (
                                  <span className="block mt-1">Capped to {d.approved_discount_percent}%.</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

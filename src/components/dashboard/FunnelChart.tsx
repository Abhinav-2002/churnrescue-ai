import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, Skeleton, EmptyState } from '@/components/ui';
import type { RecoveryFunnel } from '@/lib/types/metrics';

interface FunnelChartProps {
  funnel?: RecoveryFunnel;
  activeStage?: string | null;
  onSelectStage?: (stage: string | null) => void;
  loading?: boolean;
}

interface FunnelStageConfig {
  id: 'failed' | 'offered' | 'accepted' | 'paid';
  label: string;
  color: string;
  count: number;
}

export function FunnelChart({
  funnel,
  activeStage = null,
  onSelectStage,
  loading = false,
}: FunnelChartProps) {
  const [viewTable, setViewTable] = useState(false);

  if (loading && !funnel) {
    return (
      <Card className="min-h-[300px] flex flex-col justify-between">
        <CardHeader>
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-24" />
        </CardHeader>
        <div className="flex-1 p-5 space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-4/5" />
          <Skeleton className="h-10 w-3/5" />
          <Skeleton className="h-10 w-2/5" />
        </div>
      </Card>
    );
  }

  const stages: FunnelStageConfig[] = [
    { id: 'failed', label: '1. Failed Billing Events', color: '#ef4444', count: funnel?.failed ?? 0 },
    { id: 'offered', label: '2. Interventions Offered', color: '#3b82f6', count: funnel?.offered ?? 0 },
    { id: 'accepted', label: '3. Terms Accepted', color: '#f59e0b', count: funnel?.accepted ?? 0 },
    { id: 'paid', label: '4. Payments Captured', color: '#10b981', count: funnel?.paid ?? 0 },
  ];

  const baseline = stages[0].count;

  if (baseline === 0) {
    return (
      <Card className="min-h-[300px] flex flex-col justify-between">
        <CardHeader>
          <CardTitle>Recovery Funnel</CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400">Strict monotonic progression</p>
        </CardHeader>
        <div className="flex-1 flex items-center justify-center p-6">
          <EmptyState
            title="No billing failures recorded"
            description="The recovery pipeline will track conversion once billing events occur."
          />
        </div>
      </Card>
    );
  }

  return (
    <Card className="min-h-[300px] flex flex-col justify-between">
      <CardHeader className="flex items-center justify-between">
        <div>
          <CardTitle>Recovery Funnel</CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Failed → Offered → Accepted → Paid
          </p>
        </div>

        <button
          type="button"
          onClick={() => setViewTable(!viewTable)}
          aria-label={viewTable ? 'Switch to funnel chart view' : 'Switch to accessible table view'}
          className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          {viewTable ? 'View Funnel' : 'View Table'}
        </button>
      </CardHeader>

      {/* Active Stage Filter Chip */}
      {activeStage && (
        <div className="px-5 py-1.5 flex items-center justify-between bg-blue-50 dark:bg-blue-950/40 border-y border-blue-100 dark:border-blue-900/50 text-xs">
          <span className="text-blue-800 dark:text-blue-300">
            Filtering table by stage: <strong className="uppercase">{activeStage}</strong>
          </span>
          <button
            type="button"
            onClick={() => onSelectStage?.(null)}
            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 font-semibold underline cursor-pointer"
            aria-label="Clear funnel stage filter"
          >
            Clear Filter
          </button>
        </div>
      )}

      {viewTable ? (
        /* Accessible Table View */
        <div className="p-4 overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300 border-collapse">
            <caption className="sr-only">Recovery Pipeline Funnel Conversion Table</caption>
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                <th scope="col" className="p-2 font-semibold">Stage</th>
                <th scope="col" className="p-2 font-semibold text-right">Count</th>
                <th scope="col" className="p-2 font-semibold text-right">Conversion (% of Failed)</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((stage) => {
                const conv = baseline > 0 ? ((stage.count / baseline) * 100).toFixed(1) : '0.0';
                return (
                  <tr key={stage.id} className="border-b border-slate-100 dark:border-slate-800/50">
                    <td className="p-2 flex items-center gap-2 font-medium">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} aria-hidden="true" />
                      <span>{stage.label}</span>
                    </td>
                    <td className="p-2 text-right font-mono tabular-nums font-semibold">{stage.count}</td>
                    <td className="p-2 text-right font-mono tabular-nums">{conv}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* Monotonic Visual Bars */
        <div className="p-5 space-y-3.5">
          {stages.map((stage) => {
            const pct = baseline > 0 ? Math.min(100, Math.max(2, (stage.count / baseline) * 100)) : 0;
            const isSelected = activeStage === stage.id;

            return (
              <div
                key={stage.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                onClick={() => onSelectStage?.(activeStage === stage.id ? null : stage.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectStage?.(activeStage === stage.id ? null : stage.id);
                  }
                }}
                className={`group flex flex-col gap-1 p-2 rounded-lg transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  isSelected ? 'bg-blue-50 dark:bg-blue-950/40 ring-1 ring-blue-300 dark:ring-blue-800' : 'hover:bg-slate-50 dark:hover:bg-slate-900/60'
                }`}
              >
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                    {stage.label}
                  </span>
                  <div className="flex items-center gap-3 font-mono">
                    <span className="text-slate-400 dark:text-slate-500 tabular-nums">
                      {((stage.count / baseline) * 100).toFixed(0)}%
                    </span>
                    <span className="font-bold text-slate-900 dark:text-white tabular-nums min-w-[3ch] text-right">
                      {stage.count}
                    </span>
                  </div>
                </div>

                {/* Bar */}
                <div className="w-full bg-slate-100 dark:bg-slate-800 h-5 rounded-md overflow-hidden p-0.5">
                  <div
                    className="h-full rounded transition-all duration-300 ease-out"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: stage.color,
                      opacity: isSelected ? 1 : 0.85,
                    }}
                    aria-hidden="true"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

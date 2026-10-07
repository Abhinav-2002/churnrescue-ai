import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, Skeleton, EmptyState } from '@/components/ui';
import type { InterventionMix } from '@/lib/types/metrics';

interface DonutChartProps {
  mix?: InterventionMix;
  activeFilter?: string | null;
  onSelectAction?: (action: string | null) => void;
  loading?: boolean;
}

interface SliceConfig {
  key: keyof Omit<InterventionMix, 'total_interventions'>;
  label: string;
  color: string;
  count: number;
}

export function DonutChart({
  mix,
  activeFilter = null,
  onSelectAction,
  loading = false,
}: DonutChartProps) {
  const [viewTable, setViewTable] = useState(false);

  if (loading && !mix) {
    return (
      <Card className="min-h-[360px] flex flex-col justify-between">
        <CardHeader>
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-24" />
        </CardHeader>
        <div className="flex-1 flex items-center justify-center p-6">
          <Skeleton className="w-48 h-48 rounded-full" />
        </div>
      </Card>
    );
  }

  const total = mix?.total_interventions ?? 0;

  const slicesData: SliceConfig[] = [
    { key: 'retry', label: 'Card Swap / Retry', color: '#10b981', count: mix?.retry ?? 0 },
    { key: 'credit', label: 'Discount Applied', color: '#3b82f6', count: mix?.credit ?? 0 },
    { key: 'downgrade', label: 'Plan Downgrade', color: '#8b5cf6', count: mix?.downgrade ?? 0 },
    { key: 'pause', label: 'Account Paused', color: '#f59e0b', count: mix?.pause ?? 0 },
    { key: 'escalate', label: 'Human Escalation', color: '#ef4444', count: mix?.escalate ?? 0 },
  ];

  if (total === 0) {
    return (
      <Card className="min-h-[360px] flex flex-col justify-between">
        <CardHeader>
          <CardTitle>Intervention Mix</CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400">Autonomous recovery strategies</p>
        </CardHeader>
        <div className="flex-1 flex items-center justify-center p-6">
          <EmptyState
            title="No interventions recorded"
            description="Agent interventions (retries, credits, pauses, downgrades) will show here."
          />
        </div>
      </Card>
    );
  }

  // Calculate SVG stroke dashes for SVG circle donut
  let accumulatedOffset = 0;
  const processedSlices = slicesData.map((s) => {
    const pct = total > 0 ? (s.count / total) * 100 : 0;
    const offset = accumulatedOffset;
    accumulatedOffset -= pct;
    return {
      ...s,
      percentage: pct,
      strokeDasharray: `${pct.toFixed(2)} ${(100 - pct).toFixed(2)}`,
      strokeDashoffset: offset.toFixed(2),
    };
  });

  return (
    <Card className="min-h-[360px] flex flex-col justify-between">
      <CardHeader className="flex items-center justify-between">
        <div>
          <CardTitle>Intervention Mix</CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400">Latest customer decisions</p>
        </div>

        <button
          type="button"
          onClick={() => setViewTable(!viewTable)}
          aria-label={viewTable ? 'Switch to donut chart view' : 'Switch to accessible table view'}
          className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          {viewTable ? 'View Donut' : 'View Table'}
        </button>
      </CardHeader>

      {/* Filter indicator chip if a slice is active */}
      {activeFilter && (
        <div className="px-5 py-1.5 flex items-center justify-between bg-blue-50 dark:bg-blue-950/40 border-y border-blue-100 dark:border-blue-900/50 text-xs">
          <span className="text-blue-800 dark:text-blue-300">
            Filtering by: <strong className="capitalize">{activeFilter.replace('_', ' ')}</strong>
          </span>
          <button
            type="button"
            onClick={() => onSelectAction?.(null)}
            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 font-semibold underline cursor-pointer"
            aria-label="Clear intervention filter"
          >
            Clear Filter
          </button>
        </div>
      )}

      {viewTable ? (
        /* Accessible Table Alternative */
        <div className="p-4 overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300 border-collapse">
            <caption className="sr-only">Intervention Mix Breakdown Table</caption>
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                <th scope="col" className="p-2 font-semibold">Strategy</th>
                <th scope="col" className="p-2 font-semibold text-right">Customers</th>
                <th scope="col" className="p-2 font-semibold text-right">Share</th>
              </tr>
            </thead>
            <tbody>
              {slicesData.map((row) => {
                const pct = total > 0 ? ((row.count / total) * 100).toFixed(1) : '0.0';
                return (
                  <tr key={row.key} className="border-b border-slate-100 dark:border-slate-800/50">
                    <td className="p-2 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: row.color }} aria-hidden="true" />
                      <span>{row.label}</span>
                    </td>
                    <td className="p-2 text-right font-mono tabular-nums font-medium">{row.count}</td>
                    <td className="p-2 text-right font-mono tabular-nums">{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* Donut SVG & Legend */
        <div className="p-4 flex flex-col sm:flex-row items-center gap-6">
          <div className="relative w-44 h-44 shrink-0 mx-auto">
            <svg viewBox="0 0 42 42" className="w-full h-full transform -rotate-90 overflow-visible" role="img" aria-label="Intervention Mix Donut Chart">
              {processedSlices.map((slice) => {
                if (slice.count === 0) return null;
                const isSelected = activeFilter === slice.key;

                return (
                  <circle
                    key={slice.key}
                    r="15.915494309189533"
                    cx="21"
                    cy="21"
                    fill="transparent"
                    stroke={slice.color}
                    strokeWidth={isSelected ? '6.5' : '5'}
                    strokeDasharray={slice.strokeDasharray}
                    strokeDashoffset={slice.strokeDashoffset}
                    className="cursor-pointer transition-all hover:opacity-80 focus:outline-none"
                    tabIndex={0}
                    role="button"
                    aria-label={`${slice.label}: ${slice.count} customers (${slice.percentage.toFixed(0)}%)`}
                    onClick={() => onSelectAction?.(activeFilter === slice.key ? null : slice.key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectAction?.(activeFilter === slice.key ? null : slice.key);
                      }
                    }}
                  >
                    <title>
                      {slice.label}: {slice.count} ({slice.percentage.toFixed(0)}%)
                    </title>
                  </circle>
                );
              })}
            </svg>

            {/* Centre Label: Total customers with intervention */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
              <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
                {total}
              </span>
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Interventions
              </span>
            </div>
          </div>

          {/* Interactive Legend */}
          <div className="flex-1 w-full space-y-2">
            {slicesData.map((d) => {
              const pct = total > 0 ? (d.count / total) * 100 : 0;
              const isSelected = activeFilter === d.key;

              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => onSelectAction?.(activeFilter === d.key ? null : d.key)}
                  className={`w-full flex items-center justify-between text-xs p-1.5 rounded-lg transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-950/60 font-semibold text-blue-900 dark:text-blue-200'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                  aria-pressed={isSelected}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} aria-hidden="true" />
                    <span>{d.label}</span>
                  </div>
                  <div className="flex items-center gap-3 font-mono">
                    <span className="font-semibold tabular-nums">{d.count}</span>
                    <span className="text-slate-400 w-8 text-right tabular-nums">{pct.toFixed(0)}%</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

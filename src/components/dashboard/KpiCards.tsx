import React from 'react';
import { Card, Skeleton } from '@/components/ui';
import { formatCents } from '@/lib/format';
import type { RangeTotals, Sparklines } from '@/lib/types/metrics';

interface KpiCardsProps {
  rangeTotals?: RangeTotals;
  sparklines?: Sparklines;
  days: number;
  loading?: boolean;
}

function MiniSparkline({ data = [], color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) {
    return (
      <svg className="w-20 h-6 shrink-0" viewBox="0 0 100 28" aria-hidden="true">
        <line x1="0" y1="14" x2="100" y2="14" stroke={color} strokeWidth="2" strokeDasharray="3 3" opacity="0.4" />
      </svg>
    );
  }

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;

  const points = data
    .map((val, idx) => {
      const x = (idx / (data.length - 1)) * 96 + 2;
      const y = 26 - ((val - min) / range) * 22;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg className="w-20 h-6 shrink-0 overflow-visible" viewBox="0 0 100 28" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface DeltaBadgeProps {
  value: number | null;
  unit?: '%' | 'pts' | 'count';
  invertGoodBad?: boolean; // For failed amount and needs human, an increase is negative/bad!
  failedEventsCount: number;
  days: number;
}

function DeltaBadge({ value, unit = '%', invertGoodBad = false, failedEventsCount, days }: DeltaBadgeProps) {
  if (failedEventsCount < 3 || value === null || isNaN(value)) {
    return (
      <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">
        No prior data
      </span>
    );
  }

  const isPositive = value > 0;
  const isZero = value === 0;
  const isGood = invertGoodBad ? !isPositive : isPositive;

  const colorClass = isZero
    ? 'text-slate-500 dark:text-slate-400'
    : isGood
    ? 'text-emerald-700 dark:text-emerald-400'
    : 'text-red-700 dark:text-red-400';

  const sign = isPositive ? '+' : '';
  const formattedVal =
    unit === 'pts'
      ? `${sign}${value.toFixed(1)} pts`
      : unit === 'count'
      ? `${sign}${value}`
      : `${sign}${value.toFixed(1)}%`;

  const srDirection = isPositive ? 'Increased' : isZero ? 'Unchanged' : 'Decreased';
  const srSentence = `${srDirection} by ${Math.abs(value).toFixed(1)} ${
    unit === 'pts' ? 'percentage points' : unit === 'count' ? 'customers' : 'percent'
  } compared to the previous ${days} days`;

  return (
    <div className={`inline-flex items-center gap-1 text-xs font-semibold ${colorClass}`}>
      {!isZero && (
        <svg
          className={`w-3.5 h-3.5 shrink-0 transform ${isPositive ? '' : 'rotate-180'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
        </svg>
      )}
      <span>{formattedVal}</span>
      <span className="text-slate-600 dark:text-slate-400 font-normal">vs prev {days}d</span>
      <span className="sr-only">{srSentence}</span>
    </div>
  );
}

export function KpiCards({ rangeTotals, sparklines, days, loading = false }: KpiCardsProps) {
  const current = rangeTotals?.current;
  const previous = rangeTotals?.previous;
  const deltas = rangeTotals?.deltas;
  const prevFailedEvents = previous?.failed_events_count ?? 0;

  return (
    <section aria-label="Key Performance Indicators">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {/* KPI 1: Recovered Revenue (Hero) */}
        <Card className="border-emerald-200 dark:border-emerald-900/50 bg-gradient-to-br from-white to-emerald-50/30 dark:from-gray-900 dark:to-emerald-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-400">
              Recovered Revenue
            </span>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm" aria-hidden="true" />
          </div>
          <div className="mt-2.5 flex items-baseline justify-between gap-2">
            {loading || !current ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <div className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
                {formatCents(current.recovered_revenue_cents)}
              </div>
            )}
            <MiniSparkline data={sparklines?.recovered_revenue ?? []} color="#10b981" />
          </div>
          <div className="mt-2">
            {loading || !current ? (
              <Skeleton className="h-4 w-24" />
            ) : (
              <DeltaBadge
                value={deltas?.recovered_revenue_percent ?? null}
                failedEventsCount={prevFailedEvents}
                days={days}
              />
            )}
          </div>
        </Card>

        {/* KPI 2: Recovery Rate */}
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Recovery Rate
            </span>
            <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between gap-2">
            {loading || !current ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
                {(current.recovery_rate * 100).toFixed(1)}%
              </div>
            )}
            <MiniSparkline data={sparklines?.recovery_rate ?? []} color="#3b82f6" />
          </div>
          <div className="mt-2">
            {loading || !current ? (
              <Skeleton className="h-4 w-24" />
            ) : (
              <DeltaBadge
                value={deltas?.recovery_rate_points ?? null}
                unit="pts"
                failedEventsCount={prevFailedEvents}
                days={days}
              />
            )}
          </div>
        </Card>

        {/* KPI 3: Failed Amount */}
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Failed Amount
            </span>
            <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between gap-2">
            {loading || !current ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
                {formatCents(current.failed_amount_cents)}
              </div>
            )}
            <MiniSparkline data={sparklines?.failed_amount ?? []} color="#ef4444" />
          </div>
          <div className="mt-2">
            {loading || !current ? (
              <Skeleton className="h-4 w-24" />
            ) : (
              <DeltaBadge
                value={deltas?.failed_amount_percent ?? null}
                invertGoodBad={true}
                failedEventsCount={prevFailedEvents}
                days={days}
              />
            )}
          </div>
        </Card>

        {/* KPI 4: Customers Recovered */}
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Customers Recovered
            </span>
            <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between gap-2">
            {loading || !current ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
                {current.customers_recovered}
              </div>
            )}
            <MiniSparkline data={sparklines?.customers_recovered ?? []} color="#10b981" />
          </div>
          <div className="mt-2">
            {loading || !current ? (
              <Skeleton className="h-4 w-24" />
            ) : (
              <DeltaBadge
                value={deltas?.customers_recovered_percent ?? null}
                failedEventsCount={prevFailedEvents}
                days={days}
              />
            )}
          </div>
        </Card>

        {/* KPI 5: Needs a Human */}
        <Card className="border-amber-200 dark:border-amber-900/50 bg-gradient-to-br from-white to-amber-50/20 dark:from-gray-900 dark:to-amber-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-400">
              Needs a Human
            </span>
            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300">
              Queue
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between gap-2">
            {loading || !current ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold tracking-tight text-amber-950 dark:text-amber-200 tabular-nums">
                {current.needs_human}
              </div>
            )}
            <MiniSparkline data={sparklines?.needs_human ?? []} color="#f59e0b" />
          </div>
          <div className="mt-2">
            {loading || !current ? (
              <Skeleton className="h-4 w-24" />
            ) : (
              <DeltaBadge
                value={deltas?.needs_human_count ?? null}
                unit="count"
                invertGoodBad={true}
                failedEventsCount={prevFailedEvents}
                days={days}
              />
            )}
          </div>
        </Card>
      </div>
    </section>
  );
}

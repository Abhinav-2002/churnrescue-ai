import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, Skeleton, EmptyState } from '@/components/ui';
import { formatCents } from '@/lib/format';
import type { DailySeriesPoint } from '@/lib/types/metrics';

interface PerformanceChartProps {
  data?: DailySeriesPoint[];
  rangeDays: 7 | 14 | 30;
  onRangeChange: (days: 7 | 14 | 30) => void;
  loading?: boolean;
}

export function PerformanceChart({
  data = [],
  rangeDays,
  onRangeChange,
  loading = false,
}: PerformanceChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [viewTable, setViewTable] = useState(false);

  // If loading and no data yet
  if (loading && (!data || data.length === 0)) {
    return (
      <Card className="min-h-[360px] flex flex-col justify-between">
        <CardHeader>
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-8 w-32" />
        </CardHeader>
        <div className="flex-1 flex items-center justify-center p-6">
          <Skeleton className="h-56 w-full rounded-lg" />
        </div>
      </Card>
    );
  }

  // Insufficient history state
  if (!data || data.length === 0) {
    return (
      <Card className="min-h-[360px] flex flex-col justify-between">
        <CardHeader>
          <div>
            <CardTitle>Performance & Recovery</CardTitle>
            <p className="text-xs text-slate-500 dark:text-slate-400">Failed volume vs autonomous recovery</p>
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 bg-slate-100 dark:bg-slate-900" role="radiogroup" aria-label="Time Range">
            {([7, 14, 30] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={rangeDays === d}
                onClick={() => onRangeChange(d)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  rangeDays === d
                    ? 'bg-white dark:bg-gray-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </CardHeader>
        <div className="flex-1 flex items-center justify-center p-6">
          <EmptyState
            title="Not enough history yet"
            description={`Telemetry data for the ${rangeDays}-day window will appear once payment attempts are processed.`}
          />
        </div>
      </Card>
    );
  }

  const maxAmount = Math.max(
    ...data.map((d) => Math.max(d.failed_amount_cents, d.recovered_amount_cents)),
    100
  );

  const width = 800;
  const height = 260;
  const pTop = 20;
  const pBottom = 30;
  const pLeft = 45;
  const pRight = 20;

  const drawWidth = width - pLeft - pRight;
  const drawHeight = height - pTop - pBottom;

  const getX = (idx: number) => {
    if (data.length <= 1) return pLeft + drawWidth / 2;
    return pLeft + (idx / (data.length - 1)) * drawWidth;
  };

  const getY = (cents: number) => {
    return pTop + drawHeight - (cents / maxAmount) * drawHeight;
  };

  const pointsFailed = data.map((d, i) => `${getX(i).toFixed(1)},${getY(d.failed_amount_cents).toFixed(1)}`).join(' ');
  const pointsRecovered = data.map((d, i) => `${getX(i).toFixed(1)},${getY(d.recovered_amount_cents).toFixed(1)}`).join(' ');

  const areaFailed = `${getX(0).toFixed(1)},${(pTop + drawHeight).toFixed(1)} ${pointsFailed} ${getX(data.length - 1).toFixed(1)},${(pTop + drawHeight).toFixed(1)}`;
  const areaRecovered = `${getX(0).toFixed(1)},${(pTop + drawHeight).toFixed(1)} ${pointsRecovered} ${getX(data.length - 1).toFixed(1)},${(pTop + drawHeight).toFixed(1)}`;

  const activePoint = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < data.length ? data[hoverIndex] : null;

  return (
    <Card className="min-h-[360px] flex flex-col justify-between" id="overview">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <CardTitle>Performance & Recovery</CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Daily failed renewal volume vs captured recovery amounts (UTC)
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* View as Table Toggle */}
          <button
            type="button"
            onClick={() => setViewTable(!viewTable)}
            aria-label={viewTable ? 'Switch to chart view' : 'Switch to accessible table view'}
            className="text-xs px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {viewTable ? 'View Chart' : 'View Table'}
          </button>

          {/* Range Radio Group (7d | 14d | 30d) */}
          <div
            className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 bg-slate-100 dark:bg-slate-900"
            role="radiogroup"
            aria-label="Time Range Filter"
          >
            {([7, 14, 30] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={rangeDays === d}
                onClick={() => onRangeChange(d)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  rangeDays === d
                    ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      {/* Accessible Table Alternative */}
      {viewTable ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300 border-collapse">
            <caption className="sr-only">Daily Failed vs Recovered Telemetry Table</caption>
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                <th scope="col" className="p-2.5 font-semibold">Date (UTC)</th>
                <th scope="col" className="p-2.5 font-semibold text-right">Failed Amount</th>
                <th scope="col" className="p-2.5 font-semibold text-right">Recovered Amount</th>
                <th scope="col" className="p-2.5 font-semibold text-right">Recovery Rate</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => {
                const rate = row.failed_amount_cents > 0 ? (row.recovered_amount_cents / row.failed_amount_cents) * 100 : 0;
                return (
                  <tr key={row.date} className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-900/30">
                    <td className="p-2.5 font-mono">{row.date}</td>
                    <td className="p-2.5 text-right font-mono text-red-600 dark:text-red-400">
                      {formatCents(row.failed_amount_cents)}
                    </td>
                    <td className="p-2.5 text-right font-mono text-emerald-600 dark:text-emerald-400">
                      {formatCents(row.recovered_amount_cents)}
                    </td>
                    <td className="p-2.5 text-right font-mono tabular-nums">
                      {rate.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* SVG Interactive Chart */
        <div className="relative w-full overflow-hidden">
          {/* Legend and Active Tooltip HUD */}
          <div className="flex flex-wrap items-center justify-between text-xs px-2 mb-2">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500" aria-hidden="true" />
                <span className="text-slate-600 dark:text-slate-400 font-medium">Failed</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" aria-hidden="true" />
                <span className="text-slate-600 dark:text-slate-400 font-medium">Recovered</span>
              </div>
            </div>

            {activePoint && (
              <div
                className="text-xs font-mono font-medium px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700"
                aria-live="polite"
              >
                <span>{activePoint.date}: </span>
                <span className="text-red-600 dark:text-red-400">Failed {formatCents(activePoint.failed_amount_cents)}</span>
                <span className="mx-1 text-slate-400">|</span>
                <span className="text-emerald-600 dark:text-emerald-400">Recovered {formatCents(activePoint.recovered_amount_cents)}</span>
              </div>
            )}
          </div>

          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto min-w-[500px] overflow-visible"
            role="img"
            aria-label={`Area chart of daily failed vs recovered amounts across ${rangeDays} days`}
          >
            {/* Grid lines and Y axis ticks */}
            {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
              const y = pTop + drawHeight * pct;
              const val = maxAmount * (1 - pct);
              return (
                <g key={pct}>
                  <line
                    x1={pLeft}
                    y1={y}
                    x2={width - pRight}
                    y2={y}
                    stroke="currentColor"
                    className="text-slate-200 dark:text-slate-800"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                  <text
                    x={pLeft - 6}
                    y={y + 3}
                    textAnchor="end"
                    className="text-[10px] fill-slate-400 dark:fill-slate-500 font-mono"
                  >
                    {formatCents(val).replace('.00', '')}
                  </text>
                </g>
              );
            })}

            {/* X Axis ticks */}
            {data.map((d, i) => {
              // Show label for first, middle, last or spaced
              const step = Math.max(1, Math.floor(data.length / 5));
              const isLabelVisible = i === 0 || i === data.length - 1 || i % step === 0;
              if (!isLabelVisible) return null;
              return (
                <text
                  key={d.date}
                  x={getX(i)}
                  y={height - 8}
                  textAnchor="middle"
                  className="text-[10px] fill-slate-400 dark:fill-slate-500 font-mono"
                >
                  {d.date.length > 5 ? d.date.substring(5) : d.date}
                </text>
              );
            })}

            {/* Failed Series (Polyline + Gradient Area) */}
            <polyline points={areaFailed} fill="rgba(239, 68, 68, 0.08)" />
            <polyline
              points={pointsFailed}
              fill="none"
              stroke="#ef4444"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Recovered Series (Polyline + Gradient Area) */}
            <polyline points={areaRecovered} fill="rgba(16, 185, 129, 0.12)" />
            <polyline
              points={pointsRecovered}
              fill="none"
              stroke="#10b981"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Interactive Day Markers (Keyboard navigable via focus) */}
            {data.map((d, i) => {
              const cx = getX(i);
              const cyFailed = getY(d.failed_amount_cents);
              const cyRecovered = getY(d.recovered_amount_cents);
              const isHovered = hoverIndex === i;

              return (
                <g key={d.date}>
                  {/* Invisible broad hit target for hover & keyboard focus */}
                  <rect
                    x={cx - (drawWidth / data.length) / 2}
                    y={pTop}
                    width={drawWidth / data.length}
                    height={drawHeight}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={`${d.date} UTC: ${formatCents(d.failed_amount_cents)} failed, ${formatCents(d.recovered_amount_cents)} recovered`}
                    onMouseEnter={() => setHoverIndex(i)}
                    onMouseLeave={() => setHoverIndex(null)}
                    onFocus={() => setHoverIndex(i)}
                    onBlur={() => setHoverIndex(null)}
                    className="cursor-pointer focus:outline-none"
                  />

                  {/* Failed Point */}
                  <circle
                    cx={cx}
                    cy={cyFailed}
                    r={isHovered ? 5 : 3}
                    fill="#ef4444"
                    className="pointer-events-none transition-all duration-150"
                  />

                  {/* Recovered Point */}
                  <circle
                    cx={cx}
                    cy={cyRecovered}
                    r={isHovered ? 6 : 3.5}
                    fill="#10b981"
                    stroke="#ffffff"
                    strokeWidth={isHovered ? 2 : 1}
                    className="pointer-events-none transition-all duration-150"
                  />

                  {/* Vertical guide line on hover */}
                  {isHovered && (
                    <line
                      x1={cx}
                      y1={pTop}
                      x2={cx}
                      y2={pTop + drawHeight}
                      stroke="#94a3b8"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                      className="pointer-events-none"
                    />
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </Card>
  );
}

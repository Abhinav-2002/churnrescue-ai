import React from 'react';
import { formatCents } from '@/lib/format';

export function LineChart({ data }: { data: { date: string; failed_amount_cents: number; recovered_amount_cents: number }[] }) {
  if (!data || data.length === 0) return <div className="text-gray-400 text-sm text-center py-8">No data available</div>;

  const maxAmount = Math.max(...data.map(d => Math.max(d.failed_amount_cents, d.recovered_amount_cents)), 100);
  
  // padding
  const pY = 20;
  const pX = 10;
  
  const width = 800;
  const height = 240;
  
  const drawWidth = width - pX * 2;
  const drawHeight = height - pY * 2;
  
  const scaleX = (index: number) => pX + (index / Math.max(data.length - 1, 1)) * drawWidth;
  const scaleY = (amount: number) => pY + drawHeight - (amount / maxAmount) * drawHeight;

  const pointsFailed = data.map((d, i) => `${scaleX(i)},${scaleY(d.failed_amount_cents)}`).join(' ');
  const pointsRecovered = data.map((d, i) => `${scaleX(i)},${scaleY(d.recovered_amount_cents)}`).join(' ');

  const areaFailed = `${scaleX(0)},${scaleY(0)} ${pointsFailed} ${scaleX(data.length - 1)},${scaleY(0)}`;
  const areaRecovered = `${scaleX(0)},${scaleY(0)} ${pointsRecovered} ${scaleX(data.length - 1)},${scaleY(0)}`;

  return (
    <div className="w-full overflow-x-auto relative">
      <div className="flex justify-between items-center mb-4 text-xs font-medium px-2">
        <span className="text-gray-500">Last 14 days (UTC)</span>
        <div className="flex gap-4">
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500"></span><span className="text-gray-600 dark:text-gray-300">Failed</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500"></span><span className="text-gray-600 dark:text-gray-300">Recovered</span></div>
        </div>
      </div>
      
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto min-w-[500px]" role="img" aria-label="Line chart of failed vs recovered amounts">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(pct => {
          const y = pY + drawHeight * pct;
          const val = maxAmount * (1 - pct);
          return (
            <g key={pct}>
              <line x1={pX} y1={y} x2={width - pX} y2={y} stroke="currentColor" className="text-gray-100 dark:text-gray-800" strokeWidth="1" />
              <text x={0} y={y - 4} fill="currentColor" className="text-[10px] text-gray-400 font-sans">{formatCents(val).replace('.00', '')}</text>
            </g>
          );
        })}

        {/* Failed Area & Line */}
        <polyline points={areaFailed} fill="rgba(239, 68, 68, 0.1)" />
        <polyline points={pointsFailed} fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        
        {/* Recovered Area & Line */}
        <polyline points={areaRecovered} fill="rgba(16, 185, 129, 0.1)" />
        <polyline points={pointsRecovered} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        
        {/* Points */}
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={scaleX(i)} cy={scaleY(d.failed_amount_cents)} r="4" fill="#ef4444" className="hover:r-[6] transition-all cursor-pointer">
              <title>{d.date}: {formatCents(d.failed_amount_cents)} Failed</title>
            </circle>
            <circle cx={scaleX(i)} cy={scaleY(d.recovered_amount_cents)} r="4" fill="#10b981" className="hover:r-[6] transition-all cursor-pointer">
              <title>{d.date}: {formatCents(d.recovered_amount_cents)} Recovered</title>
            </circle>
          </g>
        ))}
      </svg>
    </div>
  );
}

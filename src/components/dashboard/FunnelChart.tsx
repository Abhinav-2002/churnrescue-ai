import React from 'react';

export function FunnelChart({ data, onStageClick }: { data: { label: string; value: number; color: string; id: string }[], onStageClick?: (id: string) => void }) {
  const max = Math.max(...data.map(d => d.value), 1); // Avoid division by zero

  return (
    <div className="w-full space-y-4">
      {data.map((d, i) => {
        const pct = (d.value / max) * 100;
        return (
          <div key={d.label} className="flex flex-col gap-1 group cursor-pointer" onClick={() => onStageClick?.(d.id)} tabIndex={0} onKeyDown={(e) => { if(e.key === 'Enter') onStageClick?.(d.id) }}>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-700 dark:text-gray-300 font-medium group-hover:underline">{d.label}</span>
              <div className="flex gap-4">
                <span className="text-gray-500">{pct.toFixed(0)}%</span>
                <span className="font-medium text-gray-900 dark:text-gray-100 min-w-[3ch] text-right">{d.value}</span>
              </div>
            </div>
            <div className="w-full bg-gray-100 dark:bg-gray-800 h-6 rounded overflow-hidden">
              <div 
                className="h-full transition-all duration-500 ease-out" 
                style={{ width: `${pct}%`, backgroundColor: d.color }}
                title={`${d.label}: ${d.value}`}
              ></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

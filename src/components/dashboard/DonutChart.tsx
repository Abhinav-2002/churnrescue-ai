import React from 'react';

export function DonutChart({ data, onSliceClick }: { data: { label: string; value: number; color: string }[], onSliceClick?: (label: string) => void }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  if (total === 0) return <div className="text-gray-400 text-sm text-center py-8">No data available</div>;

  const slices = data.reduce((acc, d) => {
    const value = (d.value / total) * 100;
    const offset = acc.currentOffset;
    acc.currentOffset -= value;
    acc.items.push({ ...d, sliceValue: value, offset });
    return acc;
  }, { currentOffset: 0, items: [] as any[] }).items;

  return (
    <div className="relative w-full flex items-center">
      <div className="relative w-full aspect-square max-w-[200px] mx-auto">
        <svg viewBox="0 0 42 42" className="w-full h-full transform -rotate-90">
          {slices.map((d, i) => {
            if (d.value === 0) return null;
            const strokeDasharray = `${d.sliceValue} ${100 - d.sliceValue}`;
            const strokeDashoffset = d.offset;
            
            return (
              <circle
                key={d.label}
                r="15.915494309189533"
                cx="21"
                cy="21"
                fill="transparent"
                stroke={d.color}
                strokeWidth="6"
                strokeDasharray={strokeDasharray}
                strokeDashoffset={strokeDashoffset}
                className="cursor-pointer transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
                onClick={() => onSliceClick?.(d.label)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSliceClick?.(d.label);
                  }
                }}
              >
                <title>{d.label}: {d.value} users ({(d.sliceValue).toFixed(0)}%)</title>
              </circle>
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-bold text-gray-800 dark:text-gray-100">{total}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">Total</span>
        </div>
      </div>
      
      {/* Legend */}
      <div className="flex-1 ml-6 space-y-3">
        {data.map(d => {
          if (d.value === 0) return null;
          return (
            <div key={d.label} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 cursor-pointer group" onClick={() => onSliceClick?.(d.label)}>
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color }}></span>
                <span className="text-gray-700 dark:text-gray-300 group-hover:underline">{d.label}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-medium text-gray-900 dark:text-white">{d.value}</span>
                <span className="text-gray-400 w-8 text-right">{((d.value / total) * 100).toFixed(0)}%</span>
              </div>
            </div>
          );
        })}
      </div>

      <table className="sr-only">
        <caption>Intervention Mix</caption>
        <tbody>
          {data.map(d => (
            <tr key={d.label}>
              <th scope="row">{d.label}</th>
              <td>{d.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

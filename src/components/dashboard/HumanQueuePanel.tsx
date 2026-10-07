import React from 'react';
import { Card, CardHeader, CardTitle, Skeleton, EmptyState } from '@/components/ui';
import { formatCents } from '@/lib/format';
import type { HumanQueueItem } from '@/lib/types/metrics';

interface HumanQueuePanelProps {
  queue?: HumanQueueItem[];
  onOpenDrawer?: (customerId: string) => void;
  loading?: boolean;
}

function getRelativeTime(timestamp: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch {
    return 'Recently';
  }
}

function SeverityBadge({ severity }: { severity: 'High' | 'Medium' | 'Low' }) {
  let badgeStyle = 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800';
  let icon = (
    <svg className="w-3 h-3 mr-1 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );

  if (severity === 'High') {
    badgeStyle = 'bg-red-100 text-red-900 border-red-300 dark:bg-red-950 dark:text-red-200 dark:border-red-800';
    icon = (
      <svg className="w-3 h-3 mr-1 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  } else if (severity === 'Low') {
    badgeStyle = 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
    icon = (
      <svg className="w-3 h-3 mr-1 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${badgeStyle}`}>
      {icon}
      <span>{severity}</span>
    </span>
  );
}

export function HumanQueuePanel({
  queue = [],
  onOpenDrawer,
  loading = false,
}: HumanQueuePanelProps) {
  if (loading && queue.length === 0) {
    return (
      <Card className="min-h-[300px] flex flex-col justify-between" id="human-queue">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-28" />
        </CardHeader>
        <div className="flex-1 p-5 space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </Card>
    );
  }

  // Sort queue by severity rank (High -> Medium -> Low) then recency
  const severityRank = { High: 0, Medium: 1, Low: 2 };
  const sortedQueue = [...queue].sort((a, b) => {
    const rankDiff = (severityRank[a.severity] ?? 1) - (severityRank[b.severity] ?? 1);
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <Card className="min-h-[300px] flex flex-col justify-between" id="human-queue">
      <CardHeader className="flex items-center justify-between">
        <div>
          <CardTitle>Needs a Human Queue</CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Escalations requiring human supervisor takeover
          </p>
        </div>

        {sortedQueue.length > 0 && (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800">
            {sortedQueue.length} Pending
          </span>
        )}
      </CardHeader>

      {sortedQueue.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <EmptyState
            title="No customers requiring human intervention"
            description="The queue is currently clear. Any complex cancellations, keywords, or disputes will appear here."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <caption className="sr-only">Needs a Human Escalation Queue Table</caption>
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-400 font-semibold">
                <th scope="col" className="p-3">Customer</th>
                <th scope="col" className="p-3">Reason</th>
                <th scope="col" className="p-3">Severity</th>
                <th scope="col" className="p-3">Waiting</th>
                <th scope="col" className="p-3 text-right">Amount</th>
                <th scope="col" className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {sortedQueue.map((item) => (
                <tr
                  key={item.customer_id}
                  className="hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors"
                >
                  <td className="p-3 font-semibold text-slate-900 dark:text-white">
                    {item.name}
                  </td>
                  <td className="p-3 capitalize font-medium text-slate-700 dark:text-slate-300">
                    {item.reason_category.replace(/_/g, ' ')}
                  </td>
                  <td className="p-3">
                    <SeverityBadge severity={item.severity} />
                  </td>
                  <td className="p-3 text-slate-500 dark:text-slate-400 font-mono">
                    {getRelativeTime(item.created_at)}
                  </td>
                  <td className="p-3 text-right font-mono text-red-600 dark:text-red-400 font-semibold">
                    {formatCents(item.failed_amount_cents)}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      onClick={() => onOpenDrawer?.(item.customer_id)}
                      className="px-2.5 py-1 text-xs font-medium rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 cursor-pointer"
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

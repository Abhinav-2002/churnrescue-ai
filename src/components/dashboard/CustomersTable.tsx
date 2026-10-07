import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, StatusPill, Skeleton, EmptyState } from '@/components/ui';
import { formatCents } from '@/lib/format';
import type { CustomerMetricRow } from '@/lib/types/metrics';

interface CustomersTableProps {
  customers?: CustomerMetricRow[];
  filterAction?: string | null;
  filterStage?: string | null;
  onClearActionFilter?: () => void;
  onClearStageFilter?: () => void;
  onOpenDrawer?: (customerId: string, triggerRef: React.RefObject<HTMLElement | null>) => void;
  loading?: boolean;
}

type SortField = 'name' | 'failed' | 'recovered' | 'usage' | 'updated';

let currentNow = 0;
const timerListeners = new Set<() => void>();
let timerInterval: ReturnType<typeof setInterval> | null = null;

function subscribeTimer(callback: () => void) {
  timerListeners.add(callback);
  if (timerListeners.size === 1 && typeof window !== 'undefined') {
    currentNow = Date.now();
    timerInterval = setInterval(() => {
      currentNow = Date.now();
      timerListeners.forEach((cb) => cb());
    }, 1000);
  }
  return () => {
    timerListeners.delete(callback);
    if (timerListeners.size === 0 && timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  };
}

function getTimerSnapshot() {
  return currentNow;
}

function getServerTimerSnapshot() {
  return 0;
}

export function CustomersTable({
  customers = [],
  filterAction = null,
  filterStage = null,
  onClearActionFilter,
  onClearStageFilter,
  onOpenDrawer,
  loading = false,
}: CustomersTableProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('updated');
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const pageSize = 25;
  const now = React.useSyncExternalStore(subscribeTimer, getTimerSnapshot, getServerTimerSnapshot);

  // Filter pipeline
  const filteredCustomers = useMemo(() => {
    let result = [...customers];

    // 1. Text Search (name or plan)
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(
        (c) => c.name.toLowerCase().includes(q) || c.plan.toLowerCase().includes(q)
      );
    }

    // 2. Status Dropdown Filter
    if (statusFilter !== 'all') {
      result = result.filter((c) => c.status.toLowerCase() === statusFilter.toLowerCase());
    }

    // 3. Intervention Mix Filter
    if (filterAction) {
      result = result.filter((c) => {
        if (!c.last_action) return false;
        if (filterAction === 'credit') return c.last_action.includes('credit') || c.last_action.includes('discount');
        if (filterAction === 'retry') return c.last_action.includes('retry') || c.last_action.includes('card');
        return c.last_action.toLowerCase().includes(filterAction.toLowerCase());
      });
    }

    // 4. Funnel Stage Filter
    if (filterStage) {
      if (filterStage === 'failed') {
        result = result.filter((c) => c.failed_amount_cents > 0);
      } else if (filterStage === 'offered') {
        result = result.filter((c) => c.intervention !== null);
      } else if (filterStage === 'accepted') {
        result = result.filter((c) => c.status === 'recovered' || c.status === 'paused');
      } else if (filterStage === 'paid') {
        result = result.filter((c) => c.recovered_amount_cents > 0);
      }
    }

    // 5. Sorting
    result.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortField === 'failed') {
        comparison = a.failed_amount_cents - b.failed_amount_cents;
      } else if (sortField === 'recovered') {
        comparison = a.recovered_amount_cents - b.recovered_amount_cents;
      } else if (sortField === 'usage') {
        comparison = a.usage_percent - b.usage_percent;
      } else if (sortField === 'updated') {
        const timeA = new Date(a.updated_at || a.last_action_at || 0).getTime();
        const timeB = new Date(b.updated_at || b.last_action_at || 0).getTime();
        comparison = timeA - timeB;
      }
      return sortAsc ? comparison : -comparison;
    });

    return result;
  }, [customers, search, statusFilter, filterAction, filterStage, sortField, sortAsc]);

  // Pagination calculations (strictly 25 per page)
  const totalRows = filteredCustomers.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedRows = filteredCustomers.slice(startIndex, startIndex + pageSize);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false); // Default descending for amounts/dates
    }
  };

  const hasActiveFilters = Boolean(search.trim() || statusFilter !== 'all' || filterAction || filterStage);

  const clearAllFilters = () => {
    setSearch('');
    setStatusFilter('all');
    onClearActionFilter?.();
    onClearStageFilter?.();
    setPage(1);
  };

  if (loading && customers.length === 0) {
    return (
      <Card className="min-h-[400px]" id="customers">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-8 w-64" />
        </CardHeader>
        <div className="p-6 space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </Card>
    );
  }

  return (
    <Card className="min-h-[400px]" id="customers">
      <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <CardTitle>Customer Accounts</CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Real-time subscriber status, interventions, and financial recovery (25 per page)
          </p>
        </div>

        {/* Search & Filter Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by customer or plan..."
              aria-label="Search customers by name or plan"
              className="w-56 sm:w-64 px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-gray-900 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 text-xs"
                aria-label="Clear search input"
              >
                ✕
              </button>
            )}
          </div>

          {/* Status Dropdown Filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by customer status"
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-gray-900 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="all">All Statuses</option>
            <option value="recovered">Recovered</option>
            <option value="at_risk">At Risk</option>
            <option value="offered">Offered</option>
            <option value="paused">Paused</option>
          </select>
        </div>
      </CardHeader>

      {/* Active Filter Chips */}
      {hasActiveFilters && (
        <div className="mx-6 mb-3 p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-blue-900 dark:text-blue-300">Active filters:</span>
          {search && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200">
              Search: &quot;{search}&quot;
            </span>
          )}
          {statusFilter !== 'all' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200 capitalize">
              Status: {statusFilter}
            </span>
          )}
          {filterAction && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200 capitalize">
              Intervention: {filterAction}
            </span>
          )}
          {filterStage && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200 capitalize">
              Funnel Stage: {filterStage}
            </span>
          )}
          <button
            type="button"
            onClick={clearAllFilters}
            className="text-blue-700 dark:text-blue-300 font-bold hover:underline ml-auto cursor-pointer"
          >
            Clear All
          </button>
        </div>
      )}

      {/* Table / Empty State */}
      {totalRows === 0 ? (
        <div className="p-8">
          <EmptyState
            title="No customers match the current criteria"
            description="Try changing your search term, resetting status filter, or clearing active chart selections."
            action={
              hasActiveFilters ? (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                >
                  Reset All Filters
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <caption className="sr-only">Customer Accounts Table</caption>
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-400 font-semibold">
                <th scope="col" className="p-3">Status</th>
                <th
                  scope="col"
                  className="p-3 cursor-pointer hover:text-slate-900 dark:hover:text-white"
                  onClick={() => handleSort('usage')}
                >
                  Usage {sortField === 'usage' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  scope="col"
                  className="p-3 cursor-pointer hover:text-slate-900 dark:hover:text-white"
                  onClick={() => handleSort('name')}
                >
                  Customer {sortField === 'name' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th scope="col" className="p-3">Plan & Price</th>
                <th scope="col" className="p-3">Last Action</th>
                <th
                  scope="col"
                  className="p-3 text-right cursor-pointer hover:text-slate-900 dark:hover:text-white"
                  onClick={() => handleSort('failed')}
                >
                  Failed Amount {sortField === 'failed' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  scope="col"
                  className="p-3 text-right cursor-pointer hover:text-slate-900 dark:hover:text-white"
                  onClick={() => handleSort('recovered')}
                >
                  Recovered {sortField === 'recovered' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th scope="col" className="p-3">Intervention</th>
                <th
                  scope="col"
                  className="p-3 cursor-pointer hover:text-slate-900 dark:hover:text-white"
                  onClick={() => handleSort('updated')}
                >
                  Updated {sortField === 'updated' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {paginatedRows.map((row) => {
                // Check if changed within last 5 seconds for highlight pulse
                const isRecent =
                  now > 0 && now - new Date(row.updated_at || row.last_action_at || 0).getTime() < 5000;
                const highlightClass = isRecent
                  ? 'bg-blue-50/80 dark:bg-blue-900/30 motion-safe:animate-pulse'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-900/40';

                return (
                  <tr
                    key={row.id}
                    onClick={(e) => {
                      const ref = { current: e.currentTarget as HTMLElement };
                      onOpenDrawer?.(row.id, ref);
                    }}
                    tabIndex={0}
                    aria-label={`Open decision details for ${row.name}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        const ref = { current: e.currentTarget as HTMLElement };
                        onOpenDrawer?.(row.id, ref);
                      }
                    }}
                    className={`transition-colors cursor-pointer ${highlightClass}`}
                  >
                    {/* Status */}
                    <td className="p-3 whitespace-nowrap">
                      <StatusPill status={row.status} />
                    </td>

                    {/* Usage Progress Bar */}
                    <td className="p-3 whitespace-nowrap font-mono tabular-nums">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${
                              row.usage_percent >= 80
                                ? 'bg-red-500'
                                : row.usage_percent >= 50
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.min(100, row.usage_percent)}%` }}
                            aria-hidden="true"
                          />
                        </div>
                        <span className="text-[11px] text-slate-600 dark:text-slate-400">
                          {row.usage_percent}%
                        </span>
                      </div>
                    </td>

                    {/* Customer Name (Strictly NO email) */}
                    <td className="p-3 font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                      {row.name}
                    </td>

                    {/* Plan & Price */}
                    <td className="p-3 whitespace-nowrap text-slate-600 dark:text-slate-400">
                      <span className="font-medium text-slate-800 dark:text-slate-200">{row.plan}</span>
                      <span className="text-[11px] ml-1 font-mono">({formatCents(row.price_cents)}/mo)</span>
                    </td>

                    {/* Last Action */}
                    <td className="p-3 whitespace-nowrap text-slate-700 dark:text-slate-300 font-medium">
                      {row.last_action ? row.last_action.replace(/_/g, ' ') : 'None'}
                    </td>

                    {/* Failed Amount */}
                    <td className="p-3 text-right font-mono tabular-nums text-red-600 dark:text-red-400 font-semibold whitespace-nowrap">
                      {formatCents(row.failed_amount_cents)}
                    </td>

                    {/* Recovered Amount */}
                    <td className="p-3 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400 font-semibold whitespace-nowrap">
                      {row.recovered_amount_cents > 0 ? formatCents(row.recovered_amount_cents) : '-'}
                    </td>

                    {/* Intervention Pill */}
                    <td className="p-3 whitespace-nowrap">
                      {row.intervention ? (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700">
                          {row.intervention}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>

                    {/* Updated Local Time */}
                    <td className="p-3 whitespace-nowrap text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                      {new Date(row.updated_at || row.last_action_at || 0).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Footer (Strictly 25 rows per page) */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="text-slate-500 dark:text-slate-400 font-mono">
          Showing {totalRows > 0 ? startIndex + 1 : 0}–{Math.min(startIndex + pageSize, totalRows)} of {totalRows} accounts
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white dark:hover:bg-slate-800 font-medium cursor-pointer"
          >
            Previous
          </button>
          <span className="px-2 font-mono text-slate-700 dark:text-slate-300">
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white dark:hover:bg-slate-800 font-medium cursor-pointer"
          >
            Next
          </button>
        </div>
      </div>
    </Card>
  );
}

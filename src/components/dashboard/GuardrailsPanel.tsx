import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, Skeleton } from '@/components/ui';
import type { GuardrailSummary, PolicyAudit } from '@/lib/types/metrics';

interface GuardrailsPanelProps {
  summary?: GuardrailSummary;
  audit?: PolicyAudit;
  loading?: boolean;
}

export function GuardrailsPanel({
  summary,
  audit,
  loading = false,
}: GuardrailsPanelProps) {
  const [showViolations, setShowViolations] = useState(false);

  if (loading && (!summary || !audit)) {
    return (
      <Card className="min-h-[300px] flex flex-col justify-between">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-28" />
        </CardHeader>
        <div className="flex-1 p-5 grid grid-cols-2 gap-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </Card>
    );
  }

  const outsideCount = audit?.outside_policy_count ?? 0;
  const totalAudited = audit?.total_audited ?? 0;
  const violatingOffers = audit?.violating_offer_ids ?? [];

  return (
    <Card className="min-h-[300px] flex flex-col justify-between" id="guardrails">
      <CardHeader className="flex items-center justify-between">
        <div>
          <CardTitle>Autonomous Guardrail Audit</CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Deterministic rule enforcement & invariant monitoring
          </p>
        </div>

        {/* Policy Audit Status Pill */}
        <div className="flex items-center gap-2">
          {outsideCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowViolations(!showViolations)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-900 border border-red-300 dark:bg-red-950 dark:text-red-200 dark:border-red-800 cursor-pointer hover:bg-red-200"
              aria-label={`${totalAudited} audited, ${outsideCount} outside policy. Click to inspect violating offer IDs`}
            >
              <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" aria-hidden="true" />
              <span>{totalAudited} audited, {outsideCount} outside policy</span>
            </button>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-900 border border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800"
              aria-label={`${totalAudited} audited, 0 outside policy. All evaluated decisions strictly adhere to policy invariants`}
            >
              <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span>{totalAudited} audited, 0 outside policy</span>
            </span>
          )}
        </div>
      </CardHeader>

      {/* Expanded Violations List Modal/Tray */}
      {showViolations && outsideCount > 0 && (
        <div className="mx-5 mb-3 p-3 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/40 text-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-red-900 dark:text-red-200">
              Violating Offer IDs ({violatingOffers.length}):
            </span>
            <button
              type="button"
              onClick={() => setShowViolations(false)}
              className="text-red-700 dark:text-red-300 hover:underline font-semibold"
            >
              Dismiss
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto font-mono text-[11px]">
            {violatingOffers.map((id) => (
              <span key={id} className="px-2 py-0.5 rounded bg-white dark:bg-gray-900 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300">
                {id}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Guardrail Metrics Grid */}
      <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
          <div className="text-xl font-bold text-slate-900 dark:text-white tabular-nums">
            {summary?.pricing_adjustments ?? 0}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-medium">
            Discount Capped
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
          <div className="text-xl font-bold text-slate-900 dark:text-white tabular-nums">
            {summary?.blocked_suggestions ?? 0}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-medium">
            Forced Retry
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
          <div className="text-xl font-bold text-slate-900 dark:text-white tabular-nums">
            {summary?.escalated_by_keyword ?? 0}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-medium">
            Keyword Escalation
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
          <div className="text-xl font-bold text-slate-900 dark:text-white tabular-nums">
            {summary?.template_enforced ?? 0}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-medium">
            Template Used
          </div>
        </div>
      </div>

      {/* Latest Numerical Clamp Footer */}
      <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
          <span className="font-semibold text-slate-800 dark:text-slate-200">Latest Clamp:</span>
          <span>{summary?.latest_clamp_summary || 'No adjustments required'}</span>
        </div>
        <div className="text-slate-500 dark:text-slate-400 font-mono tabular-nums text-[11px]">
          Total Checks: {summary?.total_checks ?? 0}
        </div>
      </div>
    </Card>
  );
}

export interface RangeTotalsCurrent {
  recovered_revenue_cents: number;
  recovery_rate: number;
  failed_amount_cents: number;
  customers_recovered: number;
  needs_human: number;
}

export interface RangeTotalsPrevious extends RangeTotalsCurrent {
  failed_events_count: number;
}

export interface RangeTotalsDeltas {
  recovered_revenue_percent: number | null;
  recovery_rate_points: number | null;
  failed_amount_percent: number | null;
  customers_recovered_percent: number | null;
  needs_human_count: number | null;
}

export interface RangeTotals {
  current: RangeTotalsCurrent;
  previous: RangeTotalsPrevious;
  deltas: RangeTotalsDeltas;
}

export interface KpiTotals {
  total_failed: number;
  total_recovered: number;
  recovery_rate: number;
  at_risk: number;
  paused: number;
  escalated: number;
  average_discount: number;
  median_hours_to_recovery: number;
}

export interface DailySeriesPoint {
  date: string;
  failed_amount_cents: number;
  recovered_amount_cents: number;
}

export interface Sparklines {
  recovered_revenue: number[];
  recovery_rate: number[];
  failed_amount: number[];
  customers_recovered: number[];
  needs_human: number[];
}

export interface InterventionMix {
  total_interventions: number;
  retry: number;
  credit: number;
  downgrade: number;
  pause: number;
  escalate: number;
}

export interface RecoveryFunnel {
  failed: number;
  offered: number;
  accepted: number;
  paid: number;
}

export interface GuardrailSummary {
  pricing_adjustments: number;
  blocked_suggestions: number;
  escalated_by_keyword: number;
  template_enforced: number;
  total_checks: number;
  latest_clamp_summary: string | null;
}

export interface PolicyAudit {
  total_audited: number;
  outside_policy_count: number;
  violating_offer_ids: string[];
}

export interface HumanQueueItem {
  customer_id: string;
  name: string;
  reason_category: string;
  severity: 'High' | 'Medium' | 'Low';
  failed_amount_cents: number;
  created_at: string;
}

export interface CustomerMetricRow {
  id: string;
  name: string;
  plan: string;
  price_cents: number;
  usage_percent: number;
  status: string;
  last_action: string | null;
  last_action_at: string | null;
  failed_amount_cents: number;
  recovered_amount_cents: number;
  intervention: string | null;
  updated_at: string;
}

export interface OfferMetricRow {
  id: string;
  customer_id: string;
  kind: string;
  discount_percent: number | null;
  ladder_step: number | null;
  amount_cents: number;
  status: string;
  created_at: string;
}

export interface RecoveryMetricRow {
  customer_id: string;
  original_amount_cents: number;
  recovered_amount_cents: number;
  created_at: string;
}

export interface DecisionMetricRow {
  created_at: string;
  customer_id: string;
  action: string;
  proposed_discount_percent: number | null;
  approved_discount_percent: number | null;
  guardrail_category: string | null;
  ladder_step: number | null;
}

export interface MetricsV2Response {
  range_days: number;
  range_totals: RangeTotals;
  kpis: KpiTotals;
  daily_series: DailySeriesPoint[];
  sparklines: Sparklines;
  intervention_mix: InterventionMix;
  funnel: RecoveryFunnel;
  guardrail_summary: GuardrailSummary;
  policy_audit: PolicyAudit;
  human_queue: HumanQueueItem[];
  customers: CustomerMetricRow[];
  offers: OfferMetricRow[];
  recoveries: RecoveryMetricRow[];
  decisions: DecisionMetricRow[];
}

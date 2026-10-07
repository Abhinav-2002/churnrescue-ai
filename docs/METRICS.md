# Metrics Dashboard API Specification v2

This document defines the data contract, query parameters, metric definitions, and invariant guarantees for `GET /api/dashboard/metrics`.

---

## 1. Query Parameters & Caching

- **Endpoint**: `GET /api/dashboard/metrics`
- **Query Parameter**:
  - `days`: Accepted values are strictly `7`, `14`, or `30`.
  - Default: `14` (when omitted).
  - Validation: Any other value (e.g. `10`, `0`, `31`, `abc`) is strictly rejected with HTTP `400 Bad Request` and body `{"error": "invalid_query"}`.
- **Caching & Transport**:
  - `Cache-Control: no-store` on all responses.
  - `ETag` (MD5 hex digest of the payload) is included in every HTTP 200 response.
  - Supports `If-None-Match` request header; returns HTTP `304 Not Modified` with an empty body when data is unchanged.
- **Rate Limiting**:
  - Protected by shared rate limiter (`LIMITS.dashboardMetrics`): 300 requests per 60-second window. Returns HTTP `429 Too Many Requests` with body `{"error": "rate_limited"}` upon limit exhaustion.

---

## 2. Response Fields & Calculation Rules

### 2.1 Range Totals & Previous Period Comparison (`range_totals`)
Metrics are evaluated over two equal-length periods based on UTC time:
- **Current Period**: `[now - days, now]`
- **Previous Period**: `[now - 2 * days, now - days)`

#### Five Core Metrics:
1. **Recovered Revenue (`recovered_revenue_cents`)**: Sum of `recovered_amount_cents` from `recoveries` created in the period.
2. **Recovery Rate (`recovery_rate`)**: Ratio of recovered revenue to failed revenue (`recovered / failed`). Defaults to `0` when `failed == 0`.
3. **Failed Amount (`failed_amount_cents`)**: Gross sum of `amount_cents` from `billing_events` with `status = 'failed'` created in the period.
4. **Customers Recovered (`customers_recovered`)**: Count of distinct `customer_id`s in `recoveries` created in the period.
5. **Needs a Human (`needs_human`)**: Count of distinct customers with an escalation in the period.

#### Delta Suppression Rule:
- A change percentage/delta is calculated and returned **ONLY** if the previous period has at least 3 failed billing events (`failed_events_count >= 3`).
- If `failed_events_count < 3`, all deltas in `range_totals.deltas` are strictly `null` (rendered in the UI as `"No prior data"`).
- All calculations guard against division by zero and NaN.

---

### 2.2 Daily Series & Sparklines (`daily_series`, `sparklines`)
- **Daily Series**: Aggregates `failed_amount_cents` and `recovered_amount_cents` grouped strictly by `DATE(created_at)` in UTC calendar days (`YYYY-MM-DD`).
- **Sparklines**: An object containing 5 arrays of length equal to `days` (one value per calendar day ending today) for mini SVG polyline rendering:
  - `recovered_revenue`
  - `recovery_rate`
  - `failed_amount`
  - `customers_recovered`
  - `needs_human`

---

### 2.3 Intervention Mix (`intervention_mix`)
- Evaluated on each customer's **LATEST decision** recorded in `agent_actions` (grouped by `customer_id`, ordered by `created_at DESC LIMIT 1`).
- Categories:
  - `retry`: Customer's latest decision was `retry`.
  - `credit`: Customer's latest decision was `partial_credit`.
  - `downgrade`: Customer's latest decision was `downgrade`.
  - `pause`: Customer's latest decision was `pause`.
  - `escalate`: Customer's latest decision was `escalate`.
- **Total Interventions (`total_interventions`)**: Sum of the above 5 categories. Explicitly represents the total count of distinct customers who have had an agent intervention (NOT "recovered users").

---

### 2.4 Recovery Funnel (`funnel`)
- **Stage 1 (Failed)**: Count of unique `billing_events` with `status = 'failed'`.
- **Stage 2 (Offered)**: Count of unique non-superseded `offers` (`status != 'superseded'`).
- **Stage 3 (Accepted)**: Count of `offers` with `status = 'accepted'` (includes accepted partial credits, downgrades, and pauses).
- **Stage 4 (Paid)**: Count of completed `recoveries`.
- **Monotonic Invariant**: Guaranteed non-increasing across stages:
  $$\text{Failed} \ge \text{Offered} \ge \text{Accepted} \ge \text{Paid}$$

---

### 2.5 Guardrail Summary (`guardrail_summary`)
Counts of deterministic code adjustments:
- `pricing_adjustments`: Decisions where proposed discount exceeded ladder allowance or policy cap.
- `blocked_suggestions`: Suggestions forced to retry (e.g. partial credit requested when usage $\ge 60\%$).
- `escalated_by_keyword`: Forced escalations triggered by keyword detection patterns.
- `template_enforced`: Natural language generation bypassed in favor of deterministic fallback templates.
- `total_checks`: Total count of `agent_actions` evaluated by the deterministic guardrail pipeline.
- `latest_clamp_summary`: Formatted numerical summary of the most recent clamped proposal, e.g. `"Model proposed 50%, code allowed 20%"`.

---

### 2.6 Computed Policy Audit (`policy_audit`)
Server-side audit re-evaluating every stored non-superseded offer against pure guardrail functions:
1. **Floor Check**: Minimum charge must be $\ge 100$ cents (`MIN_CHARGE_CENTS`), except for `kind = 'pause'` which must be 0 cents.
2. **Usage Ceiling**: `kind = 'partial_credit'` is prohibited if customer usage was $\ge 60\%$ (`PARTIAL_CREDIT_MAX_USAGE_EXCLUSIVE`).
3. **Ladder Cap**: Discount percent cannot exceed the ladder step limit ($0 \to 20\%$, $1 \to 35\%$, $2 \to 50\%$).
4. **Amount Arithmetic**: Stored `amount_cents` must equal `round(plan_price_cents * (100 - discount_percent) / 100)`.
5. **Downgrade Tier**: `kind = 'downgrade'` must target a valid tier strictly cheaper than the current plan.
- **Output**: `{ total_audited: number, outside_policy_count: number, violating_offer_ids: string[] }`.
- When compliant: `outside_policy_count: 0, violating_offer_ids: []`.
- When non-compliant: Exposes **only** the violating offer IDs (`off_...`), never exposing customer emails or private details.

---

### 2.7 Needs a Human Queue (`human_queue`)
List of customers requiring staff review:
- Fields: `customer_id`, `name`, `reason_category`, `severity`, `failed_amount_cents`, `created_at`.
- **Reason Mapping** (from actual stored clamp strings):
  - `forced escalate by keyword rule: dispute` $\to$ `dispute` (High)
  - `forced escalate by keyword rule: chargeback` $\to$ `chargeback` (High)
  - `forced escalate by keyword rule: legal` $\to$ `legal` (High)
  - `forced escalate by keyword rule: fraud` $\to$ `fraud` (High)
  - `forced escalate by keyword rule: human` $\to$ `human_requested` (Medium)
  - `forced escalate by keyword rule: anger` $\to$ `frustration` (Medium)
  - `cancel intent >= 60 usage twice -> escalate` $\to$ `repeat_cancel` (Low)
  - Other / model-initiated $\to$ `general_escalation` (Medium)
- **Sorting**: Primary sort by severity (`High` $\to$ `Medium` $\to$ `Low`), secondary sort by recency (`created_at DESC`). Row cap: 50.

---

### 2.8 Customer Rows (`customers`)
Row-capped (200) customer listing with enumerated fields:
- `id`, `name`, `plan`, `price_cents`, `usage_percent`, `status`, `last_action`, `last_action_at`, `failed_amount_cents`, `recovered_amount_cents`, `intervention`, `updated_at`.
- **Zero-PII**: Email addresses are strictly omitted from the query and response schema.

---

## 3. Privacy & Invariant Guarantees

1. **Zero Private Data Exposure**:
   - NO customer email addresses (`email`).
   - NO PayPal order IDs (`paypal_order_id`).
   - NO conversation text bodies (`conversations.text`).
   - NO model chain-of-thought or reasoning (`agent_actions.reasoning`).
   - Short error codes only (`invalid_query`, `rate_limited`, `internal_error`).
2. **Money Invariants**:
   - `recovered_amount_cents <= failed_amount_cents` for every customer and time period.
   - All monetary values are strictly positive integer cents.
   - Dashboard API is strictly read-only and performs zero financial or database mutations.

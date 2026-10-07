# DASHBOARD v2 DATA CONTRACT

**Status**: SPECIFICATION ONLY — NO APPLICATION CODE MODIFIED  
**Working Directory**: `C:\Users\DELL\Downloads\churnrescue-ai`  
**Branch**: `phase-6-dashboard-v2`  
**Compliance**: Grounded strictly in `src/lib/db.ts`, `src/lib/agent/guardrails.ts`, `src/lib/plans.ts`, and project Master Invariants.

---

## 1. Master Data Elements Table

| Panel | Element | Source (table.column or exact computation) | Definition & Business Logic | Empty State | Test Name |
|---|---|---|---|---|---|
| **Header** | Product Name | Static string `"ChurnRescue AI"` | Application title | N/A | `test_header_renders_product_name` |
| **Header** | Sandbox Badge | Static pill `"Sandbox demo, no real money"` | Environment safety indicator | N/A | `test_header_renders_sandbox_badge` |
| **Header** | Live Indicator | Polling hook state `isLive: boolean` | Pulsing green dot when polling is active; amber dot when paused | `"Paused"` | `test_header_live_indicator_status` |
| **Header** | Last Fetch Time | Polling hook state `lastSuccessfulFetch: Date \| null` | UTC timestamp formatted as local time `HH:MM:SS` of most recent HTTP 200/304 response | `"Never"` | `test_header_displays_last_fetch_time` |
| **Header** | Updated Ns Ago | Client-side reactive computation: `Math.max(0, Math.floor((currentTime - lastSuccessfulFetch) / 1000))` | Elapsed seconds since last successful API response, recomputed every 1 second via client interval timer | `"Updated -- ago"` | `test_header_computes_seconds_ago` |
| **Header** | Live Updates Toggle | Polling hook state `isLive` setter | Interactive toggle switch that halts polling timer when OFF and triggers immediate fetch + resumes polling when ON | Always interactive | `test_header_toggle_pauses_resumes_polling` |
| **Header** | Theme Toggle | Theme state `theme: 'light' \| 'dark'` | Interactive toggle button switching between light and dark modes with persistent storage (cookie / localStorage) | System preference default | `test_header_theme_toggle_persistence` |
| **Header** | Chat Demo Link | `<a href="/">Chat Demo &rarr;</a>` | Navigation link to customer-facing chat recovery interface at `/` | Always present | `test_header_links_to_chat_demo` |
| **KPI 1** | Recovered Revenue (Hero) | `SUM(recoveries.recovered_amount_cents)` WHERE `created_at >= range_start AND created_at <= range_end` | Total captured monetary amount recovered within the selected time window (cents converted to currency) | `"$0.00"` | `test_kpi_recovered_revenue_sum` |
| **KPI 1** | Recovered Revenue Delta | `((curr_recovered - prev_recovered) / prev_recovered) * 100` | Percentage change vs previous equal-length period. Displayed ONLY if previous period has `>= 3` failed billing events and `prev_recovered > 0`; otherwise `"No prior data"` | `"No prior data"` | `test_kpi_recovered_revenue_delta_threshold` |
| **KPI 1** | Recovered Revenue Sparkline | Daily array of `SUM(recoveries.recovered_amount_cents)` grouped by UTC day | Array of daily totals across the selected range rendered as mini SVG polyline | Flat line at 0 | `test_kpi_recovered_revenue_sparkline` |
| **KPI 2** | Recovery Rate | `curr_failed == 0 ? 0 : (curr_recovered / curr_failed)` | Ratio of recovered revenue to failed revenue in the selected period. Clamped between `0.0` and `1.0` (displayed as `0%` to `100%`) | `"0%"` | `test_kpi_recovery_rate_zero_failures` |
| **KPI 2** | Recovery Rate Delta | `(curr_rate - prev_rate) * 100` (percentage points) | Change in recovery rate vs previous equal-length period. Displayed ONLY if previous period has `>= 3` failed events; otherwise `"No prior data"` | `"No prior data"` | `test_kpi_recovery_rate_delta_threshold` |
| **KPI 2** | Recovery Rate Sparkline | Daily ratio `daily_recovered / daily_failed` (or 0 if daily_failed == 0) | Mini SVG trend line of daily recovery rate | Flat line at 0 | `test_kpi_recovery_rate_sparkline` |
| **KPI 3** | Failed Amount | `SUM(billing_events.amount_cents)` WHERE `status = 'failed'` AND `created_at >= range_start` | Gross monetary volume of failed renewal transactions in the selected period (cents converted to currency) | `"$0.00"` | `test_kpi_failed_amount_sum` |
| **KPI 3** | Failed Amount Delta | `((curr_failed - prev_failed) / prev_failed) * 100` | Percentage change vs previous equal-length period. Displayed ONLY if previous period has `>= 3` failed events; otherwise `"No prior data"` | `"No prior data"` | `test_kpi_failed_amount_delta_threshold` |
| **KPI 3** | Failed Amount Sparkline | Daily array of `SUM(billing_events.amount_cents)` WHERE `status = 'failed'` grouped by UTC day | Mini SVG trend line of daily gross failure volume | Flat line at 0 | `test_kpi_failed_amount_sparkline` |
| **KPI 4** | Customers Recovered | `COUNT(DISTINCT customer_id)` FROM `recoveries` WHERE `created_at >= range_start` | Unique count of individual customers who successfully completed payment in the period | `"0"` | `test_kpi_customers_recovered_count` |
| **KPI 4** | Customers Recovered Delta | `((curr_count - prev_count) / prev_count) * 100` | Percentage change vs previous equal-length period. Displayed ONLY if previous period has `>= 3` failed events and `prev_count > 0`; otherwise `"No prior data"` | `"No prior data"` | `test_kpi_customers_recovered_delta_threshold` |
| **KPI 4** | Customers Recovered Sparkline | Daily count of distinct recovered customers | Mini SVG trend line of daily customer recoveries | Flat line at 0 | `test_kpi_customers_recovered_sparkline` |
| **KPI 5** | Needs a Human | `COUNT(*)` FROM `customers` WHERE `status = 'at_risk'` AND (latest action is `'escalate'` OR `usage_percent >= 60` with repeated cancel intent) | Number of customers requiring urgent manual staff intervention | `"0"` | `test_kpi_needs_human_count` |
| **KPI 5** | Needs a Human Delta | `curr_count - prev_count` (absolute count change) | Numerical difference in open escalation queue entries vs previous period. Displayed ONLY if previous period has `>= 3` failed events; otherwise `"No prior data"` | `"No prior data"` | `test_kpi_needs_human_delta_threshold` |
| **KPI 5** | Needs a Human Sparkline | Daily count of new escalation actions | Mini SVG trend line of daily customer escalations | Flat line at 0 | `test_kpi_needs_human_sparkline` |
| **Daily Chart** | Range Selector | Radio group / tabs: `7 \| 14 \| 30` days | Controls the UTC time window for the daily series and KPI aggregations | Default `14` days | `test_daily_chart_range_selector` |
| **Daily Chart** | Failed Amount Series | Daily `SUM(billing_events.amount_cents)` WHERE `status = 'failed'` for each UTC date in range | Red line/area polyline with accessible point coordinates representing daily failed revenue | `"Not enough history yet"` | `test_daily_chart_failed_series_utc` |
| **Daily Chart** | Recovered Revenue Series | Daily `SUM(recoveries.recovered_amount_cents)` for each UTC date in range | Green line/area polyline with accessible point coordinates representing daily recovered revenue | `"Not enough history yet"` | `test_daily_chart_recovered_series_utc` |
| **Daily Chart** | Tooltip | Interactive hover/keyboard focus on day index | Accessible popup showing Date (UTC), Failed Amount, Recovered Amount, and Daily Recovery Rate | Hidden | `test_daily_chart_keyboard_tooltip` |
| **Daily Chart** | View-as-Table Toggle | Button toggling accessible HTML table | Displays semantic `<table>` alternative containing Date, Failed Amount, Recovered Amount for screen-reader users | Table with empty rows | `test_daily_chart_view_as_table_toggle` |
| **Intervention Mix** | Donut Slices | `COUNT(*)` of each customer's LATEST decision in `agent_actions.action` | Categories: `retry`, `credit` (`partial_credit`), `downgrade`, `pause`, `escalate` | `"No data available"` | `test_intervention_mix_latest_decision_grouping` |
| **Intervention Mix** | Center Value | `COUNT(DISTINCT customer_id)` with at least one record in `agent_actions` | Total customers who experienced an agent intervention (explicitly NOT "recovered users") | `"0"` | `test_intervention_mix_center_total` |
| **Intervention Mix** | Slice Filter Interaction | `onClick` / `Enter` on slice segment | Sets active customer table filter `filterAction = slice.category`. Updates filter indicator chip | N/A | `test_intervention_mix_filter_interaction` |
| **Intervention Mix** | View-as-Table Toggle | Button / Accessible hidden table | Semantic `<table>` listing Strategy, Count, and Percentage | Table with 0% rows | `test_intervention_mix_view_as_table` |
| **Recovery Funnel** | Stage 1: Failed | `COUNT(DISTINCT id)` FROM `billing_events` WHERE `status = 'failed'` in range | Top stage of pipeline: 100% baseline count of all failed billing events | `"0 (0%)"` | `test_funnel_stage_failed_count` |
| **Recovery Funnel** | Stage 2: Offered | `COUNT(DISTINCT billing_event_id)` FROM `offers` WHERE `status != 'superseded'` in range | Events that received a valid non-superseded offer | `"0 (0%)"` | `test_funnel_stage_offered_count` |
| **Recovery Funnel** | Stage 3: Accepted | `COUNT(DISTINCT billing_event_id)` FROM `offers` WHERE `status = 'accepted'` (including pause offers) in range | Events where customer accepted the terms | `"0 (0%)"` | `test_funnel_stage_accepted_count` |
| **Recovery Funnel** | Stage 4: Paid | `COUNT(DISTINCT billing_event_id)` FROM `recoveries` in range | Events where payment was captured or account preserved | `"0 (0%)"` | `test_funnel_stage_paid_count` |
| **Recovery Funnel** | Stage Filter Interaction | `onClick` / `Enter` on funnel bar | Sets active customer table filter `filterStage = stage.id`. Updates filter indicator chip | N/A | `test_funnel_filter_interaction` |
| **Guardrails** | Pricing Adjustments | `COUNT(*)` FROM `agent_actions` WHERE `details_json.proposed_discount_percent > details_json.approved_discount_percent` | Number of times code clamped model's requested discount down to ladder cap | `"0"` | `test_guardrails_discount_capped_count` |
| **Guardrails** | Blocked Suggestions | `COUNT(*)` FROM `agent_actions` WHERE `details_json.clamps` contains `'retry'` or invalid action | Number of times invalid actions or excessive usage was forced to retry | `"0"` | `test_guardrails_forced_retry_count` |
| **Guardrails** | Escalated by Keyword | `COUNT(*)` FROM `agent_actions` WHERE `details_json.clamps` contains `'forced escalate by keyword rule'` | Mandatory escalations triggered by legal/fraud/dispute keywords | `"0"` | `test_guardrails_escalated_by_keyword_count` |
| **Guardrails** | Template Enforced | `COUNT(*)` FROM `agent_actions` WHERE `details_json.clamps` contains `'template_used'` or fallback | Fallbacks invoked when model output omitted numbers or failed schema | `"0"` | `test_guardrails_template_used_count` |
| **Guardrails** | Decisions Checked | `COUNT(*)` FROM `agent_actions` in range | Total deterministic guardrail evaluations executed by code | `"0"` | `test_guardrails_total_checks_count` |
| **Guardrails** | Policy Audit | Server-side pure function re-evaluating every stored non-superseded offer against guardrail invariants | Reports `"N audited, M outside policy"`. If `M > 0`, clicking exposes list of violating offer IDs | `"0 audited, 0 outside policy"` | `test_guardrails_policy_audit_verification` |
| **Guardrails** | Latest Numerical Clamp | Most recent `agent_actions` row with clamp numbers | Text summary formatted strictly with numbers: `"Model proposed X%, code allowed Y%"` | `"No adjustments required"` | `test_guardrails_latest_clamp_numbers_only` |
| **Human Queue** | Queue Rows | Joined `customers`, `billing_events`, `agent_actions` WHERE action is `'escalate'` or status is `'at_risk'` | List of customers requiring human takeover, sorted by severity then recency | `"No customers requiring human intervention"` | `test_human_queue_rows_population` |
| **Human Queue** | Row: Customer Name | `customers.name` | Customer full name (NO EMAIL) | N/A | `test_human_queue_name_no_email` |
| **Human Queue** | Row: Reason Category | Fixed enum mapped from stored clamps (`dispute`, `chargeback`, `legal`, `fraud`, `human_requested`, `frustration`, `repeat_cancel`) | Categorized reason derived from `detectEscalation` pattern match | `"General review"` | `test_human_queue_reason_enum_mapping` |
| **Human Queue** | Row: Severity Badge | Computed enum: `'High'` \| `'Medium'` \| `'Low'` | High: dispute, chargeback, legal, fraud; Medium: human, frustration; Low: repeat cancel | N/A | `test_human_queue_severity_mapping` |
| **Human Queue** | Row: Elapsed Time | `Date.now() - agent_actions.created_at` | Relative time elapsed (e.g. `"12m ago"`, `"2h ago"`) | `"Just now"` | `test_human_queue_elapsed_time` |
| **Human Queue** | Row: Failed Amount | `billing_events.amount_cents` | The unpaid invoice amount at stake | `"$0.00"` | `test_human_queue_failed_amount` |
| **Human Queue** | Review Button | `onClick={() => openDrawer(customer.id)}` | Opens the Decision Timeline slide-over drawer for this customer | N/A | `test_human_queue_review_opens_drawer` |
| **Customers** | Search Input | Client search query string | Filters table by customer name or plan name (case-insensitive) | Empty query | `test_customers_table_search` |
| **Customers** | Status Filter Dropdown | Dropdown select: `All \| Healthy \| At Risk \| Recovered \| Paused` | Filters table rows by `customers.status` | Default `All` | `test_customers_table_status_filter` |
| **Customers** | Status Column | `customers.status` | Semantic status pill with icon and text (never colour alone) | N/A | `test_customers_table_status_pill_icon_text` |
| **Customers** | Usage Score Column | `customers.usage_percent` | Percentage and colored horizontal mini-bar | `"0%"` | `test_customers_table_usage_bar` |
| **Customers** | Customer Column | `customers.name` | Customer name. NO email address in DOM or payload | N/A | `test_customers_table_privacy_no_email` |
| **Customers** | Plan & Price Column | `customers.plan_name` + `customers.plan_price_cents` | Plan name and monthly price formatted as currency (e.g. `"Pro - $50.00/mo"`) | N/A | `test_customers_table_plan_price` |
| **Customers** | Last Action Column | `customers.last_action` | Action descriptor (e.g. `"Card updated"`, `"Discount offered"`, `"Account paused"`) | `"None"` | `test_customers_table_last_action` |
| **Customers** | Failed Amount Column | `SUM(billing_events.amount_cents)` WHERE status = 'failed' | Customer's total failed amount | `"$0.00"` | `test_customers_table_failed_amount` |
| **Customers** | Recovered Amount Column| `SUM(recoveries.recovered_amount_cents)` | Customer's total recovered amount, or `"-"` if 0 | `"-"` | `test_customers_table_recovered_amount` |
| **Customers** | Intervention Column | Latest offer kind or action pill | Pill indicating intervention: `"Card Swap"`, `"Discount (20%)"`, `"Pause"`, `"Escalate"` | `"-"` | `test_customers_table_intervention_pill` |
| **Customers** | Updated Column | `customers.last_action_at` or `created_at` | Formatted local date and time of last interaction | `"--"` | `test_customers_table_updated_timestamp` |
| **Customers** | Pagination Controls | Page buttons (Previous, Next, page numbers) | Paginates customer list at 25 rows per page | 1 page | `test_customers_table_pagination_25_rows` |
| **Customers** | Row Click / Drawer | Row click handler `openDrawer(customer.id)` | Opens slide-over drawer displaying chronological decision timeline | N/A | `test_customers_table_row_click_opens_drawer` |
| **Drawer** | Focus Trap | Accessible DOM dialog container | Traps keyboard focus within drawer when open; returns focus to triggering element on close | N/A | `test_drawer_focus_trap_and_return` |
| **Drawer** | Esc Key Handler | `onKeyDown` window listener for `Escape` | Closes drawer and returns focus cleanly | N/A | `test_drawer_esc_closes` |
| **Drawer** | Decision Timeline | Chronological list of `agent_actions` for selected customer | Enumerated list of timestamps, actions, discount proposed vs approved, and guardrail clamps applied | `"No decisions recorded yet."` | `test_drawer_timeline_enumerated_fields` |
| **Navigation** | Overview Link | `<a href="#overview">Overview</a>` | In-page smooth scroll anchor | Always active | `test_navigation_overview_anchor` |
| **Navigation** | Customers Link | `<a href="#customers">Customers</a>` | In-page smooth scroll anchor | Always active | `test_navigation_customers_anchor` |
| **Navigation** | Human Queue Link | `<a href="#human-queue">Needs a Human</a>` | In-page smooth scroll anchor with badge count | Always active | `test_navigation_human_queue_anchor` |
| **Navigation** | Guardrails Link | `<a href="#guardrails">Guardrails</a>` | In-page smooth scroll anchor | Always active | `test_navigation_guardrails_anchor` |

---

## 2. A1. Header Specification

1. **Product Name**: `"ChurnRescue AI"` rendered as semantic `<h1>` with tabular subtext `"Autonomous agentic recovery for failed payments at the point of experience."`
2. **"Sandbox Demo" Badge**: High-contrast pill: `"Sandbox demo, no real money"` (light: `bg-slate-100 text-slate-800 border-slate-300`, dark: `bg-slate-800 text-slate-200 border-slate-700`).
3. **Live Indicator**:
   - Polling Active: Animated green pulse dot (`bg-emerald-500`) + `"Live"`.
   - Polling Paused (manual toggle or hidden tab): Amber dot (`bg-amber-500`) + `"Paused"`.
4. **Last Successful Fetch Time**: Extracted directly from response timestamp and displayed as `HH:MM:SS` (e.g. `14:02:11`).
5. **"Updated Ns ago" (Reactive Computation)**:
   - Evaluated as:
     $$\Delta t = \max\left(0, \left\lfloor \frac{t_{\text{current}} - t_{\text{last\_fetch}}}{1000} \right\rfloor\right)$$
   - Formatted as: `"Updated <1s ago"` if $\Delta t < 1$, else `"Updated ${Delta t}s ago"`.
   - Updated continuously via a 1000ms `setInterval` effect that triggers a lightweight state tick without network overhead.
6. **Live Updates Toggle**:
   - Accessible toggle switch (`role="switch"`, `aria-checked`).
   - When toggled OFF: immediately cancels active polling timers and aborts in-flight fetch via `AbortController`.
   - When toggled ON: immediately executes an in-flight fetch and restarts the 3000ms polling schedule.
7. **Theme Toggle**:
   - Accessible button with `aria-label="Switch to dark theme"`.
   - Switches `<html>` class between `'light'` and `'dark'`.
   - Persists state synchronously to `localStorage.setItem('theme', ...)` wrapped in `try/catch` to avoid crashes in restricted iframe environments.
8. **Chat Demo Link**:
   - External-style button linking to `/`: `<Link href="/">Chat Demo &rarr;</Link>`.

---

## 3. A2. Five KPI Cards Specification

Every card displays: Current Period Value, Change vs Previous Period (Arrow + Sign + Percentage + sr-only descriptive sentence), Mini Trend Sparkline, and Accessible Label.

### Period Calculation:
- `Current Period`: `[T_now - range_days, T_now]`
- `Previous Equal-Length Period`: `[T_now - 2 * range_days, T_now - range_days)`
- `Prior Data Condition`: A change percentage is calculated and rendered **ONLY** if the previous period has:
  $$\text{COUNT}(\text{billing\_events WHERE status = 'failed' in previous period}) \ge 3$$
  If count $< 3$, the card MUST display `"No prior data"` in place of the percentage delta.

### KPI Card Definitions:

1. **Recovered Revenue (Hero Card)**:
   - **Current Value**: $\sum \text{recoveries.recovered\_amount\_cents}$ in current period. Formatted via `formatCents`.
   - **Delta**: $\frac{V_{\text{curr}} - V_{\text{prev}}}{V_{\text{prev}}} \times 100$. If $V_{\text{prev}} == 0$, display `"+100%"` if $V_{\text{curr}} > 0$ else `"0%"`.
   - **Trend Line**: Daily captured amounts rendered as SVG sparkline.
   - **Empty State**: `"$0.00"`.

2. **Recovery Rate**:
   - **Current Value**: 
     $$\text{Rate} = \begin{cases} 0 & \text{if } \text{Failed}_{\text{curr}} == 0 \\ \frac{\text{Recovered}_{\text{curr}}}{\text{Failed}_{\text{curr}}} & \text{otherwise} \end{cases}$$
   - **Delta**: $(\text{Rate}_{\text{curr}} - \text{Rate}_{\text{prev}}) \times 100$ percentage points.
   - **Trend Line**: Daily recovery rate ratio rendered as SVG sparkline.
   - **Empty State**: `"0%"`.

3. **Failed Amount**:
   - **Current Value**: $\sum \text{billing\_events.amount\_cents}$ WHERE `status = 'failed'` in current period.
   - **Delta**: $\frac{V_{\text{curr}} - V_{\text{prev}}}{V_{\text{prev}}} \times 100$.
   - **Trend Line**: Daily gross failed renewal amounts rendered as SVG sparkline.
   - **Empty State**: `"$0.00"`.

4. **Customers Recovered**:
   - **Current Value**: $\text{COUNT}(\text{DISTINCT customer\_id})$ in `recoveries` in current period.
   - **Delta**: $\frac{C_{\text{curr}} - C_{\text{prev}}}{C_{\text{prev}}} \times 100$.
   - **Trend Line**: Daily distinct recovered customer counts rendered as SVG sparkline.
   - **Empty State**: `"0"`.

5. **Needs a Human**:
   - **Current Value**: $\text{COUNT}(*)$ from `customers` currently marked `status = 'at_risk'` with latest action `'escalate'` or unresolved keyword rule.
   - **Delta**: $C_{\text{curr}} - C_{\text{prev}}$ (absolute customer count change).
   - **Trend Line**: Daily escalation volume rendered as SVG sparkline.
   - **Empty State**: `"0"`.

---

## 4. A3. Failed vs Recovered by Day Specification

- **Range Selection**: Toggle tabs for `7 days`, `14 days`, and `30 days`.
- **Timezone**: All daily buckets are grouped strictly by **UTC calendar day** (`YYYY-MM-DD`).
- **Data Series**:
  1. `Failed Series`: Sum of failed billing events in cents for that UTC day. Rendered in red (`#ef4444`).
  2. `Recovered Series`: Sum of recovered capture amounts in cents for that UTC day. Rendered in emerald (`#10b981`).
- **Zero-Point & One-Point States**:
  - `0 Points`: Renders a calm banner: `"Not enough history yet"`.
  - `1 Point`: Renders a single centered data marker with horizontal dashed reference line and label `"1 day of data recorded"`.
- **Tooltip**: Focusable SVG markers accessible via `Tab` and Arrow keys. Displays Date, Failed Amount, Recovered Amount, and Net Saved.
- **View-as-Table**: Toggle button reveals an accessible HTML `<table>` alternative containing headers `Date (UTC)`, `Failed Payments`, `Recovered Revenue`.

---

## 5. A4. Intervention Mix Specification

- **Data Source**: Every customer's **LATEST decision** recorded in `agent_actions` (grouped by `customer_id` ORDER BY `created_at DESC LIMIT 1`).
- **Categories**:
  1. `Card Swap / Retry`: `action = 'retry'`
  2. `Discount Applied`: `action = 'partial_credit'`
  3. `Downgrade Plan`: `action = 'downgrade'`
  4. `Pause Account`: `action = 'pause'`
  5. `Human Escalation`: `action = 'escalate'`
- **Center Value**:
  - Represents: **TOTAL CUSTOMERS WITH AN INTERVENTION**.
  - Formula: $\text{COUNT}(\text{DISTINCT customer\_id})$ who have had an agent action.
  - **Explicit Invariant**: Must **NOT** be labelled "Recovered Users".
- **Interactivity**: Clicking or pressing `Enter` on any donut segment filters the Customers table below to that intervention category. Clicking a "Clear Filter" chip restores the unfiltered view.

---

## 6. A5. Recovery Funnel Specification

### Funnel Stages:
1. **Failed Payments**:
   - Source: $\text{COUNT}(\text{DISTINCT id})$ from `billing_events` WHERE `status = 'failed'` in selected range.
2. **Offered Intervention**:
   - Source: $\text{COUNT}(\text{DISTINCT billing\_event\_id})$ from `offers` WHERE `status != 'superseded'` in selected range.
3. **Accepted Offer**:
   - Source: $\text{COUNT}(\text{DISTINCT billing\_event\_id})$ from `offers` WHERE `status = 'accepted'` (includes accepted partial credits, downgrades, and pauses) in selected range.
4. **Payment Successful / Saved**:
   - Source: $\text{COUNT}(\text{DISTINCT billing\_event\_id})$ from `recoveries` in selected range.

### Monotonic Non-Increasing Invariant:
$$\text{Counts}_{\text{Failed}} \ge \text{Counts}_{\text{Offered}} \ge \text{Counts}_{\text{Accepted}} \ge \text{Counts}_{\text{Paid}}$$
- **Guarantee Mechanism**:
  1. Every `offer` requires a valid foreign key referencing an existing `billing_event` with `status = 'failed'`.
  2. An offer can only transition to `'accepted'` if it was previously created as `'offered'`.
  3. A `recovery` record is written strictly upon verified capture of an `'accepted'` offer.
  4. Pauses are counted as accepted interventions; for billing events where a pause was accepted, they count toward Stage 3 (Accepted) and preserve customer retention.
- **Test Required**: `test_funnel_counts_strictly_monotonic` verifies this inequality on seeded data, live mock runs, and empty states.

---

## 7. A6. Guardrails at Work & Policy Audit Specification

### Guardrail Counts:
1. **Discount Capped / Ladder Limited**:
   - Evaluated by checking `details_json.proposed_discount_percent > details_json.approved_discount_percent` or clamp matching `'ladder'`.
2. **Forced Retry**:
   - Evaluated by clamp matching `'retry'` (e.g. usage $\ge 60\%$ attempting partial credit, or invalid model action).
3. **Escalated by Keyword**:
   - Evaluated by clamp matching `'forced escalate by keyword rule'`.
4. **Template Used**:
   - Evaluated by clamp matching `'template_used'` or fallback trigger.
5. **Decisions Checked**:
   - Total count of `agent_actions` evaluated by the deterministic guardrail pipeline.

### Computed Policy Audit:
- **Execution**: The server queries all stored non-superseded `offers` in the database and re-validates each record against the pure guardrail invariants:
  1. `Floor Check`: Minimum charge must be $\ge 100$ cents (`MIN_CHARGE_CENTS`), except for `kind = 'pause'` which is 0 cents.
  2. `Usage Ceiling Check`: If `kind = 'partial_credit'`, the customer's `usage_percent` at offer time must be $< 60\%$ (`PARTIAL_CREDIT_MAX_USAGE_EXCLUSIVE`).
  3. `Discount Cap Check`: `discount_percent` must be $\le 50\%$ (`MAX_DISCOUNT_PERCENT`) and match ladder step $0 \to 20\%$, $1 \to 35\%$, $2 \to 50\%$.
  4. `Arithmetic Check`: $\text{amount\_cents} == \text{round}(P_{\text{cents}} \times (100 - \text{pct}) / 100)$.
  5. `Downgrade Plan Check`: If `kind = 'downgrade'`, `target_plan` must be a real tier with lower price than the customer's current plan.
- **Reporting**:
  - Displays: `"N audited, M outside policy"`.
  - When $M == 0$: Displays a green checkmark pill `"100% Policy Compliance (0 violations)"`.
  - When $M > 0$: Displays an amber warning button `"M outside policy"`. Clicking opens a modal/popover listing **only the violating Offer IDs** (`off_...`).
  - **Privacy Guarantee**: Under no circumstances are customer names, emails, or free text displayed in violation lists.
- **Numerical Example**:
  - Text: `"Model proposed 50%, code allowed 20%"`.
  - Grounding: Extracted from actual stored clamps where `proposed_discount_percent` was clamped by code. If no clamped record exists in the database, this is labelled as a specification illustrative example.

---

## 8. A7. Needs a Human Queue Specification

### Data Fields:
1. `name`: Customer full name (`customers.name`). **NO EMAIL**.
2. `reason_category`: Fixed enum derived from real stored clamps.
3. `severity`: High / Medium / Low.
4. `time_since`: Relative time string since escalation (e.g. `"14m ago"`).
5. `failed_amount`: Failed invoice amount in cents formatted via `formatCents`.

### Mapping Stored Clamp Strings to Reason Enum:
Based on `src/lib/agent/guardrails.ts:37-44` and `src/lib/agent/guardrails.ts:60-72`:

| Real Stored Clamp Substring | Fixed Reason Enum | Severity Level |
|---|---|---|
| `forced escalate by keyword rule: dispute` | `dispute` | **High** |
| `forced escalate by keyword rule: chargeback` | `chargeback` | **High** |
| `forced escalate by keyword rule: legal` | `legal` | **High** |
| `forced escalate by keyword rule: fraud` | `fraud` | **High** |
| `forced escalate by keyword rule: human` | `human_requested` | **Medium** |
| `forced escalate by keyword rule: anger` | `frustration` | **Medium** |
| `cancel intent >= 60 usage twice -> escalate` | `repeat_cancel` | **Low** |
| None (Model directly proposed `escalate`) | `general_escalation` | **Medium** |

### Sorting Invariant:
1. Primary sort: **Severity Rank** (`High` = 0, `Medium` = 1, `Low` = 2).
2. Secondary sort: **Recency** (`agent_actions.created_at DESC`).

---

## 9. A8. Customers Table & Drawer Specification

### Table Columns:
1. **Status**: Icon + Text pill:
   - `Recovered`: Check icon + `"Recovered"` (emerald)
   - `At Risk`: Warning icon + `"At Risk"` (rose)
   - `Offered`: Sparkle icon + `"Offered"` (blue)
   - `Paused`: Pause icon + `"Paused"` (amber)
   - `Needs Human`: Exclamation icon + `"Needs Human"` (orange)
2. **Usage Score**: Progress bar + tabular numeral (e.g. `78%`).
3. **Customer**: `customers.name` only. **Zero email addresses**.
4. **Plan & Price**: `Starter ($25.00/mo)` | `Pro ($50.00/mo)` | `Enterprise ($150.00/mo)`.
5. **Last Action**: Enumerated descriptor (`"Card updated"`, `"Discount offered"`, `"Account paused"`, `"Escalated to human"`).
6. **Failed Amount**: Formatted currency with `tabular-nums`.
7. **Recovered Amount**: Formatted currency with `tabular-nums` or `"-"`.
8. **Intervention**: Pill (`"Card Swap"`, `"Discount (20%)"`, `"Pause"`, `"Escalate"`).
9. **Updated**: Local time timestamp (`"Oct 26, 2:01 PM"`).

### Table Controls & Pagination:
- **Search**: Filters rows client-side matching `name` or `plan_name`.
- **Status Filter**: Dropdown filtering by exact `customers.status`.
- **Pagination**: Strictly 25 rows per page with accessible page controls.
- **Row Highlight**: Rows with decisions created in the last 5 seconds receive a subtle highlight pulse (`bg-blue-50/50 dark:bg-blue-900/20`), disabled under `@media (prefers-reduced-motion: reduce)`.

### Slide-Over Drawer:
- **Trigger**: Clicking any customer row or clicking `"Review"` in the Needs a Human Queue.
- **Focus Management**:
  - Focus trap keeps keyboard navigation inside the drawer.
  - `Escape` key immediately closes the drawer.
  - On close, focus returns cleanly to the triggering row button.
- **Decision Timeline**:
  - Displays chronological cards of `agent_actions` for the selected customer.
  - Enumerated fields only: Timestamp, Action Name, Proposed Discount %, Approved Discount %, Guardrail Clamp Applied.
  - **No LLM reasoning text, no prompt text, no customer message bodies**.

---

## 10. A9. Navigation Specification

- **Navigation Items (Real in-page anchors only)**:
  1. `Overview`: href `#overview`
  2. `Customers`: href `#customers`
  3. `Needs a Human`: href `#human-queue` (includes reactive badge count)
  4. `Guardrails`: href `#guardrails`
- **Responsive Layout**:
  - Screen Width $\ge 1280\text{px}$: Persistent left sidebar.
  - Screen Width $< 1280\text{px}$: Clean top sticky navigation bar.
- **Dead Navigation Elimination**: Mockup items "Interventions", "Analytics", and "Settings" are completely removed because all relevant data lives on the single Overview dashboard.

---

## 11. A10. Invariants and Required Test Suite

Every stated invariant must have its own named unit or integration test:

| Invariant | Exact Condition | Test Name |
|---|---|---|
| **Money Invariant** | `recovered_amount_cents <= failed_amount_cents` for any period or customer | `test_invariant_recovered_never_exceeds_failed` |
| **Funnel Monotonicity** | `funnel.failed >= funnel.offered >= funnel.accepted >= funnel.paid` | `test_invariant_funnel_counts_strictly_monotonic` |
| **Intervention Mix Sum** | `mix.retry + mix.credit + mix.downgrade + mix.pause + mix.escalate == total_customers_with_intervention` | `test_invariant_intervention_mix_sums_to_total` |
| **Counts Match Rows** | `kpis.customers_recovered == count(customers WHERE status = 'recovered')` | `test_invariant_kpi_counts_match_table_row_counts` |
| **Delta Suppression** | `delta === null` when previous period has `< 3` failed events | `test_invariant_delta_null_when_insufficient_prior_data` |
| **Policy Audit Efficacy** | Audit reports `0` on clean fixture; reports `>= 1` when an illegal offer is injected | `test_invariant_policy_audit_detects_deliberate_corruption` |
| **Strict Privacy** | Response JSON keys and recursive string scan contain 0 emails, 0 PayPal IDs, 0 reasoning text | `test_invariant_zero_pii_emails_or_order_ids_in_response` |

---

## 12. A11. Mockup Reconciliation (Retained, Renamed, Dropped)

| Mockup Element | Disposition | Rationale & Truth Alignment |
|---|---|---|
| Left Sidebar Logo & Tagline | **Retained** | Brand identity preserved (`"ChurnRescue AI"`). |
| Sidebar "Overview" | **Retained** | Links to `#overview` anchor. |
| Sidebar "Customers" | **Retained** | Links to `#customers` anchor. |
| Sidebar "Interventions" | **Dropped** | Redundant; intervention mix and funnel are already embedded on `#overview`. |
| Sidebar "Human Queue (2)" | **Retained & Renamed** | Renamed to `"Needs a Human"` with live badge counter; links to `#human-queue`. |
| Sidebar "Analytics" | **Dropped** | Dead link; all analytics are on `#overview`. |
| Sidebar "Guardrails" | **Retained** | Links to `#guardrails` anchor. |
| Sidebar "Settings" | **Dropped** | Dead link; dashboard is strictly read-only billing operations view. |
| Sidebar "PayPal Sandbox Connected" | **Dropped** | Violates Rule 20 ("No PayPal, AG Grid or third-party logos/trademarks"). |
| Sidebar "Live Mode Switch" | **Retained & Renamed** | Renamed to `"Live updates"` toggle; genuinely pauses/resumes polling. |
| Sidebar "AI Concierge / Try Demo" | **Retained & Renamed** | Renamed to clean link pointing to customer-facing chat demo at `/`. |
| Header Brand & Subtitle | **Retained** | Clean typography hierarchy. |
| Header "Sandbox Demo" Badge | **Retained** | Clearly marks sandbox environment. |
| Header Live Status + Timestamp | **Retained** | Displays live status and `"Updated Ns ago"`. |
| Header Theme Toggle | **Retained** | Accessible light/dark toggle. |
| Header "Chat Demo" Button | **Retained** | Accessible link to `/`. |
| KPI 1: "Recovered MRR" | **Renamed** | Renamed to `"Recovered Revenue"` (in recovery ops, captured cash is measured, not MRR). |
| KPI 2: "Recovery Rate" | **Retained** | Truthful recovered / failed ratio with divide-by-zero protection. |
| KPI 3: "Failed Payments" | **Renamed** | Renamed to `"Failed Amount"` (clarifies dollar volume vs event count). |
| KPI 4: "Recovered Users" | **Renamed** | Renamed to `"Customers Recovered"` (aligns with domain entity `customers`). |
| KPI 5: "Needs Human" | **Renamed** | Renamed to `"Needs a Human"` for proper grammar. |
| Daily Chart: Failed vs Recovered | **Retained** | UTC daily aggregation with 7/14/30d range toggles and tooltip. |
| Donut: "342 Recovered Users" in center | **Renamed** | Renamed to `"Total Customers with an Intervention"` (truth-in-data: customers with retries or escalations are not all recovered). |
| Donut: Strategy Slices | **Retained & Enhanced** | Slices for Retry, Credit, Downgrade, Pause, Escalate with click-to-filter. |
| Recovery Funnel: 4 Stages | **Retained** | Monotonic non-increasing pipeline with stage-click filtering. |
| Guardrails: "Policy compliance 100%" | **Enhanced** | Upgraded from static claim to a **COMPUTED policy audit** that re-evaluates all stored offers. |
| Guardrails: Numerical Example | **Retained** | Displays `"Model proposed 50%, code allowed 20%"` when backed by clamp data. |
| Human Queue: Customer Rows | **Retained** | Filtered by severity and recency. Customer name, failed amount, time elapsed. |
| Human Queue: Subtitle/Reasons | **Standardized** | Mapped to fixed reason enums from stored clamps. |
| Table: Email Address (`rohan@company.com`) | **DROPPED** | Strictly dropped for privacy (Rule 19: NO emails in dashboard API or UI). |
| Table: Usage Score Bar | **Retained** | Visual percentage bar. |
| Table: Customer Name, Plan, Price | **Retained** | Clean typography with tabular numerals. |
| Table: Last Action & Amounts | **Retained** | Enumerated descriptors and formatted currency. |
| Table: Pagination & Search | **Retained** | 25 rows per page, client-side name/plan search. |
| Slide-over Drawer | **Retained & Enhanced** | Added accessible focus trap, Esc to close, and focus return. |

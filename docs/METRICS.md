# Metrics Dashboard Definitions

This document defines precisely how each key performance indicator (KPI), funnel stage, and daily series metric is calculated for the ChurnRescue AI dashboard. 

## Funnel Stages
1. **Failed**: The count of unique `billing_events` with `status = 'failed'`.
2. **Offered**: The count of unique `offers` that were presented to the user, strictly excluding those where `status = 'superseded'`.
3. **Accepted**: The count of `offers` strictly with `status = 'accepted'`. (Once captured, the offer remains accepted and a recovery is generated).
4. **Paid**: The total count of successful `recoveries` (transactions successfully processed and captured via PayPal).

## Key Performance Indicators (KPIs)
*   **Total Failed**: Total number of failed billing events (equals the Failed funnel stage).
*   **Total Recovered**: Total number of successful recoveries (equals the Paid funnel stage).
*   **Recovery Rate**: Calculated as `Total Recovered / Total Failed`. If nothing has failed (Total Failed = 0), this defaults to `0`.
*   **At-Risk**: The count of customers whose current status in the database is strictly `at_risk`.
*   **Paused**: The count of customers whose current status in the database is strictly `paused`.
*   **Escalated**: The count of customers whose most recent interaction (the `last_action` in the `agent_actions` log) is `escalate`.
*   **Average Discount**: The mathematical average of the `discount_percent` across all valid (non-superseded) offers that carry a discount > 0.
*   **Median Hours to Recovery**: The median time difference between when a billing event was created and when the corresponding recovery record was created.

## Rules and Exclusions
*   **Superseded Offers**: Whenever the agent makes a new proposal (due to pushback or escalation), previous uncaptured offers are marked as `superseded`. These are *never* counted in the Offered or Accepted funnels, nor do they factor into Average Discount.
*   **Timezone Handling**: All daily series aggregations (`daily_series`) are grouped by `DATE(created_at)` using standard UTC. The backend SQLite database natively stores all `CURRENT_TIMESTAMP` timestamps in UTC. No local timezone offsets are applied at the query level.
*   **Free Text Leakage Prevention**: For privacy and security, no `messages`, `conversation` text, PayPal `order_id`s, payloads, emails, or free-form model reasoning strings ever leave the `/api/dashboard/metrics` route.

## Guardrail Categories Mapping
Whenever an agent's decision is constrained by code (rather than accepted raw from the LLM), the enforcement reason is mapped to a rigid enum for analytics:
*   `escalated_by_keyword`: The customer triggered a predefined human-escalation keyword or rule.
*   `retry_forced`: The user intent or usage threshold disallowed alternative offers (e.g., trying to downgrade or ask for credit at high usage).
*   `ladder_limited`: The agent proposed a higher discount than permitted by the current step in the concession ladder, resulting in a clamp down to the approved amount.
*   `template_used`: The natural language generation was bypassed entirely in favor of a hardcoded template for safety.

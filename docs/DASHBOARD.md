# Dashboard v2

## Metric Definitions
*   **Recovered revenue**: Sum of all `amount_cents` for recovered customers. Shown in dollars.
*   **Recovery rate**: Percentage of at-risk customers who were successfully recovered.
*   **Failed amount**: Sum of `amount_cents` for all at-risk (failed payment) customers. Shown in dollars.
*   **Customers recovered**: Count of unique customers whose status is `recovered`.
*   **Needs a human**: Count of escalated cases that require manual intervention.

## State Behavior
*   **Loading**: Shows skeleton screens while data is being fetched.
*   **Empty**: Shown when there is no data available for the selected timeframe.
*   **Error**: Shown when there's an issue fetching data (e.g., API failure). Provides a "Retry" button.
*   **Stale**: If the `Live updates` toggle is on but no fresh data is received within 15 seconds, a warning banner appears indicating that it's "Reconnecting...".
*   **Data**: Default state when data is successfully fetched and rendered.

## Guardrail Panel
The Guardrail Panel displays instances where the automated agent's behavior was constrained by the system's guardrails to protect business interests:
*   **Capped**: The offered discount exceeded the maximum allowed limit for the customer's risk tier and was reduced.
*   **Retried**: The agent attempted to make an offer without verifying constraints and was forced to retry.
*   **Escalated**: The conversation matched a high-risk keyword or intent (e.g., legal threat, severe frustration) and was forwarded to a human agent.
*   **Template**: A predefined message template was used instead of an open-ended LLM response.
*   **Checked**: The number of decisions that went through the guardrail checks.
*   **Audit Row**: Continuously re-evaluates past offers against the current policy logic. It reports the total number of offers audited and any that were found to be outside the policy (M > 0). If M > 0, clicking the row will reveal the offending offer IDs.

## Screenshots

*   `[PLACEHOLDER: 1366px light mode]`
*   `[PLACEHOLDER: 1366px dark mode]`
*   `[PLACEHOLDER: 768px tablet layout]`
*   `[PLACEHOLDER: Drawer open]`
*   `[PLACEHOLDER: Empty state]`
*   `[PLACEHOLDER: Error state]`

# ChurnRescue AI — Financial, Policy & Privacy Invariants (`docs/INVARIANTS.md`)

ChurnRescue AI enforces three classes of non-negotiable invariants in deterministic TypeScript and SQLite constraints: **Money Invariants**, **Policy & State Invariants**, and **Privacy & Security Invariants**.

---

## 1. Money Invariants

1. **Integer Cents Only (`src/lib/money.ts`):**
   - All internal prices, offer amounts, failed renewal amounts, and captured recovery amounts are stored and compared as positive integer cents (`plan_price_cents`, `amount_cents`, `recovered_amount_cents`). Floating-point arithmetic is never used for financial state.
2. **Minimum Charge Floor (`MIN_CHARGE_CENTS = 100`):**
   - Every non-pause offer must satisfy `amount_cents >= 100` (`$1.00`). Pause offers (`kind = 'pause'`) must have `amount_cents === 0`.
3. **Deterministic Concession Arithmetic:**
   - For any `partial_credit` offer with discount percentage $d \in \{20, 35, 50\}$ and plan price $P_{\text{cents}}$:
     $$\text{amount\_cents} = \max\left(100, \text{round}\left(\frac{P_{\text{cents}} \times (100 - d)}{100}\right)\right)$$
4. **Recovered Never Exceeds Failed (`recovered_amount_cents <= failed_amount_cents`):**
   - For every recovery row, customer row, and dashboard time window (`7d`, `14d`, `30d`), captured recovered revenue never exceeds gross failed renewal revenue, and `0 <= recovery_rate <= 1.0`.
5. **Authoritative Server-Side Capture Verification (`D1`, `D2`):**
   - `POST /api/offers/:offerId/capture` ignores any amount passed in the request body or query string.
   - Before calling PayPal `/capture`, the server fetches `GET /v2/checkout/orders/:orderId` and verifies `currency_code === 'USD'` and `amount_cents === offer.amount_cents`.
   - After calling `/capture`, the server verifies `status === 'COMPLETED'` and the captured unit amount equals `offer.amount_cents` before inserting into `recoveries`.

---

## 2. Policy & Conversation-State Invariants

1. **High-Usage Discount Prohibition (`PARTIAL_CREDIT_MAX_USAGE_EXCLUSIVE = 60`):**
   - Customers with `usage_percent >= 60` are never eligible for `partial_credit`. Any model proposal on a high-usage account is deterministically routed to full-price `retry` (`0%` discount) or `downgrade` (to a strictly cheaper real plan tier).
2. **Monotonic Concession Ladder (`0 -> 20%`, `1 -> 35%`, `2 -> 50%`):**
   - A customer can advance at most one ladder step per `negotiate` turn (`nextLadderStep`).
   - Asking a billing question (`intent = 'question'`, `E2`), verbally accepting (`intent = 'accept'`, `E5`), or declining (`intent = 'decline'`, `D5`/`E3`) never resets `ladder_step` to `0` and never advances past step `2`.
   - Pushing back on price after step `2` (`previousLadder >= 2` and `intent = 'negotiate'`) triggers immediate escalation (`repeat_pushback`, `Low` severity) and supersedes all open offers.
3. **Mandatory Keyword Escalation (`detectEscalation`):**
   - Customer messages matching `dispute`, `chargeback`, `legal`, `fraud`, `human`, or `anger` patterns immediately override all other intents, supersede open offers, create zero new offers, and add the customer to `human_queue`.
4. **Explicit Two-Step Pause Confirmation (`E1`):**
   - Requesting a pause (`intent = 'pause_request'`) creates a `pending` pause offer (`0` cents), returns `nextStep: "confirm_pause"`, and leaves `customers.status = 'at_risk'`.
   - Deterministic reply validation (`src/lib/agent/graph.ts:266-273`) rejects any LLM wording claiming the pause has already been processed before the customer clicks **Confirm Pause** (`POST /api/agent/confirm-pause`).
5. **Reply Amount & Floor Truthfulness (`checkMessageAmounts`):**
   - Every dollar figure (`$X` or `$X.XX`) in an outgoing agent message must belong to `{offer.amount_cents, customer.plan_price_cents, ...previous_offer_cents}` and must include the required current offer amount.
   - The agent is prohibited from claiming `"lowest rate"` or `"can't go lower"` when `lower_tier_available === true`.
6. **Funnel Monotonicity by Nested-Set Construction:**
   - Dashboard funnel stages satisfy $\text{Failed} \ge \text{Offered} \ge \text{Accepted} \ge \text{Paid}$ by set inclusion ($\text{Paid} \subseteq \text{Accepted} \subseteq \text{Offered} \subseteq \text{Failed}$) without `Math.min`/`Math.max` clamping.
7. **Sample Data Isolation (`is_sample`):**
   - Rows with `is_sample = 1` are excluded by default (`include_sample=0`), never alter `customers.status`, cannot create PayPal orders (`createOrderInternal` returns `null`), and cannot be captured (`400 sample_offer_not_capturable`).

---

## 3. Privacy & Security Invariants

1. **Zero-PII Dashboard API (`GET /api/dashboard/metrics`):**
   - Never returns customer email addresses (`email`), PayPal order IDs (`paypal_order_id`), conversation message bodies (`conversations.text`), or raw LLM chain-of-thought (`agent_actions.reasoning`).
2. **Redacting Structured Logger (`src/lib/logger.ts`):**
   - Automatically scrubs emails, `Bearer` / `Basic` tokens, PayPal secrets/tokens, prompts, and customer message text from all structured log entries.
3. **Startup Config & Readiness Safety (`src/lib/config.ts`):**
   - Enforces `PAYPAL_BASE_URL === 'https://api-m.sandbox.paypal.com'` and reports only variable **names** (never values) when startup validation fails.

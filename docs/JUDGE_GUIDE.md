# ChurnRescue AI — Judge & Evaluator Guide

Welcome to **ChurnRescue AI**, an autonomous, guardrail-enforced payment recovery system built with Next.js 16, LangGraph, Google Cloud Vertex AI (`gemini-3.5-flash-lite`), SQLite (`better-sqlite3`), and PayPal Checkout v6 Sandbox.

> **Sandbox & Ephemeral Demo Notice:** This environment runs strictly against **PayPal Sandbox** (`https://api-m.sandbox.paypal.com`)—no real money is ever charged. Demo data is stored in an instance-local SQLite database and resets when the container restarts.

---

## 1. Try It in 3 Minutes (4 Guided Paths)

Open the **Analytics Dashboard** (`/dashboard`) and expand the **"Try it in 3 minutes — Guided Judge Walkthrough"** panel at the top (or open `/admin` directly). Each path below has a dedicated **Try Path** button and a **Reset** button that resets *only* that customer without affecting other concurrent evaluators.

### Path 1: Discount Concession Ladder & Floor (`Alice` — `c_1`, Starter `$25.00/mo`, 15% usage)
1. Click **Try Path** on **1. Discount Ladder + Floor (Alice)** (or simulate failure for **Alice** on `/admin`).
2. **Turn 1 (Initial Offer):** Because Alice's usage is `< 60%` (`15%`), the deterministic ladder assigns **Step 0 (20% discount)** $\to$ **`$20.00`** (`2000` cents).
3. **Turn 2:** Send `"can you make it $10"` $\to$ Code advances to **Step 1 (35% discount)** $\to$ **`$16.25`** (`1625` cents) and supersedes the `$20.00` offer.
4. **Turn 3:** Send `"$10 i can afford"` $\to$ Code advances to **Step 2 (50% floor)** $\to$ **`$12.50`** (`1250` cents), states `"best I can offer"`, and offers the **pause** alternative. The model is never allowed to echo or promise `"$10"`.
5. **Turn 4 (Optional pushback or question):**
   - Ask a billing question (`"Wait, when does this discount expire?"`) $\to$ The `$12.50` offer remains `pending` (`ladder_step: 2`) and the PayPal button stays active (`nextStep: 'checkout'`).
   - Push back again (`"still too much"`) $\to$ Immediate escalation to the **Needs a Human** queue (`repeat_pushback`, `Low` severity), superseding open offers.

### Path 2: High-Usage Full-Price Retry & PayPal Sandbox Capture (`Hannah` — `c_8`, Enterprise `$150.00/mo`, 85% usage)
1. Click **Try Path** on **2. High Usage Retry (Hannah)** (or simulate failure for **Hannah** on `/admin`).
2. Because Hannah's usage is $\ge 60\%$ (`85%`), `enforcePolicy` deterministically blocks `partial_credit` (`PARTIAL_CREDIT_MAX_USAGE_EXCLUSIVE = 60`) and forces a full-price **`$150.00`** retry (`15000` cents, `0%` discount).
3. Click the **PayPal** button in the chat widget to launch the PayPal Sandbox modal (`createOrder` $\to$ `onApprove` $\to$ `POST /api/offers/:offerId/capture`).
   - *Sandbox Buyer Note:* Completing the popup checkout requires signing in with a **PayPal Sandbox Personal (Buyer) account** in the PayPal modal. No sandbox buyer passwords are stored in this repository; evaluators may use any standard PayPal Developer Sandbox buyer account or inspect the pre-verified live capture for Hannah (`Order 3LG77311TG3677635`, `Capture 81485234NB008850W`, `$150.00 USD`).

### Path 3: Explicit Two-Step Pause Confirmation (`Charlie` — `c_3`, Starter `$25.00/mo`, 10% usage)
1. Click **Try Path** on **3. Pause Confirmation (Charlie)**.
2. Send `"Can I pause my subscription for a month?"`.
3. The agent creates a pending `pause` offer (`0` cents), returns `nextStep: "confirm_pause"`, and asks you to click **Confirm Pause** below—explicitly stating that your subscription **has not been paused yet**. Customer status remains `at_risk`.
4. Click **Confirm Pause** in the widget $\to$ Calls `POST /api/agent/confirm-pause`, which transitions the offer to `accepted` and the customer status to `paused`.

### Path 4: Immediate Keyword Escalation (`Diana` — `c_4`, Pro `$50.00/mo`, 45% usage)
1. Click **Try Path** on **4. Keyword Escalation (Diana)**.
2. Send `"this is a chargeback"`.
3. `detectEscalation` matches the compliance keyword (`chargeback`) before any LLM proposal can take effect, supersedes all open offers, creates no new offer, replies with the handoff message, and adds Diana to the **Needs a Human** queue on `/dashboard` with reason **`Chargeback`** and severity **`High`**.

---

## 2. Per-Customer Reset vs. Global Reset

- **Per-Customer Reset (`POST /api/demo/reset-customer`):**
  - Available via the **Reset** button on each card in the **"Try it in 3 minutes"** bar, the **Reset Customer Only** button inside the **Customer Decision Timeline Drawer** on `/dashboard`, and the **Reset Customer** button on every row in `/admin`.
  - Resets *only* the selected customer back to their seed state (`healthy`) and removes only their non-sample billing events, offers, actions, recoveries, and conversation messages. Other customers and sample history remain untouched.
- **Global Reset (`POST /api/reset`):**
  - Disabled by default when `HOSTED_DEMO=1` (returns `403 {"error": "hosted_reset_disabled"}`) so one visitor cannot wipe another visitor's in-progress session. Can be re-enabled in private/local environments with `ALLOW_GLOBAL_RESET=1`.

---

## 3. Live Data vs. Sample History (`is_sample`)

- **Default View (`Live`):** By default, `/dashboard` queries `GET /api/dashboard/metrics?days=14&include_sample=0`, displaying **only real database records** from live agent sessions and PayPal Sandbox captures.
- **Sample History Toggle (`Live + sample`):**
  - Click **Load sample history** in the dashboard header (`POST /api/demo/sample` with `{"action": "load"}`) to populate 12 synthetic historical billing events, offers, actions, and recoveries across the current and prior 14-day windows (`is_sample = 1`).
  - Toggle between **Live** and **Live + sample** in the header. When **Live + sample** is active, an **"Includes sample data"** badge and a live-vs-sample breakdown banner appear above the KPI cards.
  - **Strict Isolation Invariant:** Sample rows (`is_sample = 1`) never alter `customers.status`, never enter active conversations, cannot create PayPal orders (`create_recovery_order` rejects sample rows), and cannot be captured (`POST /api/offers/:offerId/capture` rejects sample rows).

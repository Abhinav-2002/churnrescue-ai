# ChurnRescue AI

**Autonomous, Guardrail-Enforced Payment Recovery at the Point of Experience**

ChurnRescue AI is an agentic involuntary-churn and failed-renewal recovery platform built with **Next.js 16 (App Router)**, **LangGraph**, **Google Cloud Vertex AI (`gemini-3.5-flash-lite`)**, **PayPal Checkout JS SDK v6 + Orders v2 (Sandbox)**, and **SQLite (`better-sqlite3`)**.

Unlike unconstrained chatbots that can hallucinate prices or grant unauthorized discounts, ChurnRescue AI separates **conversational intent & tone** (handled by the LLM) from **financial & policy authority** (enforced deterministically in code). The model cannot propose discount percentages or dollar amounts, cannot skip the concession ladder, cannot discount high-usage accounts ($\ge 60\%$), and cannot bypass PayPal pre-capture order verification.

---

## Quick Links & Documentation

- **[Judge & Evaluator Guide (`docs/JUDGE_GUIDE.md`)](docs/JUDGE_GUIDE.md)** — 3-minute guided walkthrough of all 4 core paths, per-customer reset, and sample history toggle.
- **[Claims & Evidence Matrix (`docs/CLAIMS.md`)](docs/CLAIMS.md)** — Every architectural, guardrail, and payment claim mapped to exact `file:line`, test file, and verification command.
- **[System Architecture (`docs/ARCHITECTURE.md`)](docs/ARCHITECTURE.md)** — Mermaid diagrams for the 4-node LangGraph pipeline, PayPal v6 checkout flow, and Dashboard v2.
- **[Financial, Policy & Privacy Invariants (`docs/INVARIANTS.md`)](docs/INVARIANTS.md)** — Formal specification of money, ladder, usage, and zero-PII invariants.
- **[Testing & Mutation Proofs (`docs/TESTING.md`)](docs/TESTING.md)** — Unit/integration suite (`265` tests across `35` files), `D4`/`D5`/`D7` mutation proofs, real-model evaluation, and smoke tests.
- **[Manual Verification Matrix (`docs/MANUAL_TEST_PLAN.md`)](docs/MANUAL_TEST_PLAN.md)** — Full 26-row manual test matrix (`M1`–`M26`) and live real-model edge cases (`E1`–`E5`).
- **[PayPal v6 Integration Review (`docs/PAYPAL_REVIEW.md`)](docs/PAYPAL_REVIEW.md)** — Atomic order claiming, `PayPal-Request-Id` idempotency, pre-capture amount verification, and `INSTRUMENT_DECLINED` recovery.
- **[Cloud Run Deployment Guide (`docs/DEPLOY_CLOUD_RUN.md`)](docs/DEPLOY_CLOUD_RUN.md)** & **[Operations Runbook (`docs/RUNBOOK.md`)](docs/RUNBOOK.md)**.

---

## Core Capabilities

1. **Deterministic Concession Ladder (`20% → 35% → 50%` Floor):**
   - Low-usage accounts (`usage_percent < 60%`) step deterministically through `20%` (`step 0`), `35%` (`step 1`), and `50%` (`step 2` floor) on pushback.
   - `proposalSchema` omits discount fields entirely—the LLM cannot propose prices. Every outgoing reply is checked by `checkMessageAmounts()` against stored offer cents; any hallucinated dollar figure is replaced with a deterministic template.
2. **High-Usage Guardrail ($\ge 60\%$ Usage):**
   - Accounts with `usage_percent >= 60%` (e.g., Hannah `c_8` at `85%` on Enterprise `$150.00/mo`) are deterministically blocked from `partial_credit` (`PARTIAL_CREDIT_MAX_USAGE_EXCLUSIVE = 60`) and routed to full-price retry (`$150.00`) or plan downgrade.
3. **Two-Step Explicit Pause Confirmation (`E1`):**
   - Requesting a pause creates a `pending` pause offer (`0` cents) and returns `nextStep: "confirm_pause"`. Deterministic reply validation ensures the agent never claims the subscription is already paused before the customer clicks **Confirm Pause** (`POST /api/agent/confirm-pause`).
4. **Compliance Keyword & Pushback Escalation:**
   - Keywords matching `chargeback`, `dispute`, `legal`, `fraud`, `human`, or `anger` (`detectEscalation()`), or a 4th price pushback after the `50%` floor, immediately supersede open offers and route the customer to the **Needs a Human** queue on `/dashboard` sorted by severity (`High` $\to$ `Medium` $\to$ `Low`).
5. **PayPal Checkout v6 + Orders v2 Sandbox Verification:**
   - Atomic SQLite order claiming (`D4`) prevents duplicate PayPal orders under concurrent requests.
   - Pre-capture verification (`GET /v2/checkout/orders/:id`) validates order status, currency (`USD`), and exact amount in cents against the database offer before calling `/capture`.
6. **Multi-Visitor Safe Demo Isolation (`Stage R1`):**
   - Per-customer reset (`POST /api/demo/reset-customer`) resets a single customer without disturbing other evaluators.
   - Global reset (`POST /api/reset`) is locked (`403 hosted_reset_disabled`) when `HOSTED_DEMO=1`.
   - Synthetic 14-day sample history (`is_sample = 1`) can be toggled on `/dashboard` (`Live` vs. `Live + sample`) and is strictly isolated from PayPal order creation, capture, and live customer status.

---

## Prerequisites & Windows Native Module Note (`D0`)

- **Node.js:** `>= 22.0.0` (tested on `v22.17.0`).
- **Native Addon (`better-sqlite3@13.0.3`):**
  - Because `better-sqlite3@13.0.3` includes `binding.gyp` in its npm package tarball, running `npm ci` from a fresh clone invokes `node-gyp rebuild` when a matching prebuilt binary is not cached.
  - **On Native Windows:** Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **"Desktop development with C++"** workload (MSVC v143 + Windows 10/11 SDK) and Python 3.10+.
  - **Zero-Toolchain Alternatives:** Run via **Docker** (`docker build -t churnrescue-ai .`, which uses `node:22-bookworm-slim` with `python3 make g++`), **WSL2 Ubuntu**, or use the hosted **Google Cloud Run** deployment.

---

## Local Setup & Commands

1. **Install dependencies:**
   ```bash
   npm ci
   ```
2. **Configure environment:**
   Copy `.env.example` to `.env` and populate your PayPal Sandbox credentials and Google Cloud project (`GOOGLE_CLOUD_PROJECT`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`).
3. **Start the development server:**
   ```bash
   npm run dev
   ```
   - Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard) for the **Analytics & Operations Dashboard** (includes the **"Try it in 3 minutes"** guided walkthrough bar).
   - Open [http://localhost:3000/admin](http://localhost:3000/admin) for the **Admin & Chat Simulation View**.
4. **Run verification gates:**
   ```bash
   # TypeScript typecheck + ESLint + Vitest unit/integration suite (35 files, 265 tests)
   npm run check

   # Production standalone build
   npm run build

   # Automated 7-gate HTTP smoke suite against running server
   npx tsx scripts/smoke.ts

   # Live Vertex AI evaluation script (requires RUN_REAL_EVAL=1)
   RUN_REAL_EVAL=1 npm run eval:real
   ```

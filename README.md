# ChurnRescue AI

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Cloud%20Run-brightgreen?style=flat-square&logo=googlecloud)](https://churnrescue-ai-550444407405.us-central1.run.app)
[![Release](https://img.shields.io/badge/Release-v1.0.0-blue?style=flat-square&logo=github)](https://github.com/Abhinav-2002/churnrescue-ai/releases/tag/v1.0.0)
[![Tests](https://img.shields.io/badge/Tests-35%20passed%20·%20266%20tests-success?style=flat-square)](docs/TESTING.md)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

**Autonomous, Guardrail-Enforced Payment Recovery at the Point of Experience**

ChurnRescue AI is an agentic involuntary-churn and failed-renewal recovery platform. It rescues lost subscription revenue by engaging customers immediately upon billing failure with empathetic, LLM-powered conversational assistance—backed by **deterministic financial guardrails** that cannot hallucinate pricing, skip policy steps, or bypass payment verification.

- 🌐 **Verified Hosted Demo:** [https://churnrescue-ai-550444407405.us-central1.run.app](https://churnrescue-ai-550444407405.us-central1.run.app)
- 📊 **Analytics Dashboard:** [https://churnrescue-ai-550444407405.us-central1.run.app/dashboard](https://churnrescue-ai-550444407405.us-central1.run.app/dashboard)
- 🛠️ **Admin & Simulator View:** [https://churnrescue-ai-550444407405.us-central1.run.app/admin](https://churnrescue-ai-550444407405.us-central1.run.app/admin)

---

## 🎬 Demo Video

A full 70-second motion-graphics and interaction walkthrough demonstrating failure simulation, AI concession negotiation, deterministic floor clamping, native PayPal Checkout capture, 2-step pause confirmation, human escalation, and live telemetry is available:

- 📥 **[Watch / Download Demo Video (`churnrescue-ai-demo.mp4`)](https://github.com/Abhinav-2002/churnrescue-ai/releases/download/v1.0.0/churnrescue-ai-demo.mp4)**  
  *(Note: GitHub release assets are downloadable MP4 files [17.89 MB, 1080p, 70.0s]. Download and open in your local media player or browser).*
- 📦 **[GitHub Release Page (`v1.0.0`)](https://github.com/Abhinav-2002/churnrescue-ai/releases/tag/v1.0.0)**

---

## 💡 The Problem & The Solution

| The Industry Problem | The ChurnRescue AI Solution |
|---|---|
| **$48B+ Lost Annually:** SaaS companies lose up to 9% of MRR to involuntary churn—expired cards, transient processor declines, and billing fatigue. | **Immediate In-App Interception:** Engages the customer right at the moment of payment failure inside the application. |
| **Passive Dunning Emails Fail:** Generic emails ("Please update your billing info") suffer from <15% open rates and multi-day resolution latency. | **Conversational Negotiation:** Conversational support powered by Google Cloud Vertex AI (`gemini-3.5-flash-lite`). |
| **LLM Price Hallucination Risk:** Unconstrained chatbots can invent unauthorized discounts, echo customer bids, or grant free lifetime access. | **Separation of Authority:** Conversational empathy handled by the LLM; financial decisions, discount math, and payment capture strictly governed by deterministic code. |

---

## 🛡️ Core Capabilities & Financial Guardrails

```
Customer Renewal Fails ($25.00)
       │
       ▼
[Turn 1] AI Offers Step 0: 20% Off ($20.00)
       │
       ▼ Customer bids "$10"
[Turn 2] Deterministic Step 1: 35% Off ($16.25)
       │
       ▼ Customer pushes back "$10 I CAN AFFORD"
[Turn 3] Hard Policy Floor: 50% Off ($12.50)
       │  "Our maximum retention courtesy is $12.50. I cannot go lower."
       ▼ Customer accepts ("YES")
[Capture] Native PayPal Checkout Orders v2 ($12.50 captured)
       │
       ▼ Customer restored to "healthy" in database ($40.00 recovered)
```

1. **Deterministic Concession Ladder (`20% → 35% → 50%` Policy Floor):**
   - Low-usage accounts (`usage_percent < 60%`) step strictly through `20%` (step 0), `35%` (step 1), and `50%` (step 2 floor).
   - `proposalSchema` omits discount fields entirely—the LLM is structurally incapable of proposing prices.
   - Outgoing messages are checked against database offer amounts (`checkMessageAmounts()`); any hallucinated figure is replaced with an approved deterministic template.
2. **High-Usage Guardrail ($\ge 60\%$ Utilization):**
   - High-usage customers (e.g., Hannah Abbott `c_8` at 85% usage on Enterprise `$150.00/mo`) are deterministically blocked from discounts and routed to full-price retry or plan downgrade.
3. **Two-Step Explicit Pause Protection (`E1`):**
   - Requesting a pause creates a pending offer and returns `nextStep: "confirm_pause"`. The agent never claims the subscription is paused until the customer explicitly clicks **Confirm Pause** (`POST /api/agent/confirm-pause`).
4. **Compliance Keyword & Dispute Escalation:**
   - Mentions of `chargeback`, `dispute`, `fraud`, `lawyer`, `legal`, or `human` immediately halt AI discounting and route the customer to the **Needs a Human** queue sorted by severity (`High` $\to$ `Medium` $\to$ `Low`).
5. **Turn-4 Floor Pushback Escalation:**
   - A 4th price pushback after reaching the 50% floor automatically escalates to a human supervisor without advancing the ladder.
6. **Atomic PayPal Orders v2 Sandbox Integration:**
   - Atomic SQLite order claiming (`D4`) prevents duplicate order creation under concurrent clicks.
   - Pre-capture order verification (`GET /v2/checkout/orders/:id`) checks amount, currency (`USD`), and status before calling `/capture`.
7. **Multi-Visitor Safe Demo Isolation (`Stage R1`):**
   - Per-customer reset (`POST /api/demo/reset-customer`) resets only the targeted customer without affecting other evaluators.
   - Global reset (`POST /api/reset`) is locked (`403 hosted_reset_disabled`) when `HOSTED_DEMO=1`.
   - Synthetic 14-day sample history toggle (`Live` vs. `Live + sample`) is strictly isolated from live financial state.

---

## 🖼️ Screenshot Gallery

All 8 submission screenshots are captured from the genuine application and stored in [`docs/assets/screenshots/`](docs/assets/screenshots/):

### 1. Operations & Analytics Dashboard (`Light Mode · Live`)
Header with `"Sandbox demo, no real money"` badge, expanded **"Try it in 3 minutes"** bar (4 guided paths), and the 5 KPI cards (`$150.00` Recovered Revenue, `1` Customer Recovered, `Needs a Human`).

![01-dashboard-overview-light.png](docs/assets/screenshots/01-dashboard-overview-light.png)

---

### 2. Operations & Telemetry Dashboard (`Dark Mode · Live + Sample History`)
Switched to **Live + sample**, showing the `"Includes sample data"` badge, live-vs-sample breakdown banner, 14-day **Failed vs Recovered by Day** chart, **Intervention Mix** donut, and **Recovery Funnel** ($222.50 recovered revenue, 33.0% recovery rate, zero audit errors).

![02-dashboard-sample-history-dark.png](docs/assets/screenshots/02-dashboard-sample-history-dark.png)

---

### 3. Autonomous Guardrail Audit & Needs a Human Queue
Autonomous Guardrail Audit panel (`Concession Ladder`, `Forced Retry`, `Keyword Escalation`, `Template Used`, `0 outside policy`) and **Needs a Human** queue showing **Diana Prince** (`Chargeback`, `High`, `$50.00`) immediately escalated upon dispute keywords.

![03-guardrails-and-human-queue.png](docs/assets/screenshots/03-guardrails-and-human-queue.png)

---

### 4. Customer Decision Timeline Drawer
Slide-over **Customer Decision Timeline Drawer** showing chronological guardrail audit cards, intent classifications, outcome codes, and the per-customer isolated reset action.

![04-customer-decision-drawer.png](docs/assets/screenshots/04-customer-decision-drawer.png)

---

### 5. Multi-Turn Concession Ladder & Hard Floor Clamp (`Alice Smith`)
Support Chat conversation demonstrating the deterministic concession ladder: `$20.00` (step 0, 20% off) $\to$ `$16.25` (step 1, 35% off) $\to$ `$12.50` (step 2 floor clamp, 50% max policy) with bright yellow PayPal Checkout button rendered upon terms acceptance.

![05-chat-ladder-floor-alice.png](docs/assets/screenshots/05-chat-ladder-floor-alice.png)

---

### 6. High-Usage Guardrail & Full-Price Retry (`Hannah Abbott`)
High-usage account (85% utilization on Enterprise `$150.00/mo`) deterministically blocked from discounting and offered a full-price retry with the live **PayPal Checkout v6** button rendered.

![06-paypal-checkout-hannah.png](docs/assets/screenshots/06-paypal-checkout-hannah.png)

---

### 7. Two-Step Explicit Pause Confirmation (`Charlie Brown · E1`)
Two-step explicit pause invariant: customer requests a 30-day pause, AI explains `"Please click Confirm Pause below to proceed. Your subscription has not been paused yet."`, rendering **Confirm Pause** and **Cancel** buttons without premature database state changes.

![07-pause-confirmation-charlie.png](docs/assets/screenshots/07-pause-confirmation-charlie.png)

---

### 8. Release Verification & Smoke Gates Terminal Capture
Clean terminal capture showing passing typecheck, ESLint, Vitest test suite (`35 files, 266 tests passing`), and automated 7-gate Cloud Run HTTP smoke suite (`[SMOKE SUCCESS] All 7 smoke gates passed`).

![08-terminal-verification-gates.png](docs/assets/screenshots/08-terminal-verification-gates.png)

---

## 🏗️ Architecture & Technology Stack

```
Customer Client (Browser)
       │
       ▼ Next.js 16 (App Router)
   API Routes (/api/agent/chat, /api/paypal/*, /api/dashboard/*)
       │
       ├─► LangGraph 4-Node Pipeline
       │     ├─► classify_intent (Vertex AI gemini-3.5-flash-lite)
       │     ├─► propose_recovery_action (Deterministic Ladder Logic)
       │     ├─► apply_guardrails (Floor Clamp & Escalation Checks)
       │     └─► generate_message (Tone & Explanations with Fallbacks)
       │
       ├─► SQLite Database (better-sqlite3)
       │     └─► Invariants: Atomic D4 Claim, Zero PII Columns
       │
       └─► PayPal REST API (Sandbox Orders v2)
             └─► Pre-Capture Verification & Idempotent Capture
```

- **Frontend & Routing:** Next.js 16 (App Router), React 19, Tailwind CSS.
- **AI Agent & State Machine:** LangGraph, Google Cloud Vertex AI (`gemini-3.5-flash-lite`).
- **Payment Engine:** PayPal Checkout JS SDK v6, PayPal Orders v2 REST API (Sandbox).
- **Data Store:** SQLite (`better-sqlite3`) with zero-PII telemetry schema.
- **Cloud Infrastructure:** Google Cloud Run (containerized, least-privilege service account, zero user-managed keys, Google Secret Manager).

---

## 🧪 Automated Testing & Release Verification

ChurnRescue AI is verified by an extensive automated test and smoke suite:

| Verification Suite | Count | Result |
|---|---|---|
| **Vitest Unit & Integration Suites** | 35 files · 266 tests | **100% PASS** |
| **Mutation Proofs (`D4`, `D5`, `D7`)** | 3 suites | **100% PASS** |
| **Live Model Edge Cases (`E1`–`E5`)** | 5 edge case suites | **100% PASS** |
| **Cloud Run 7-Gate Smoke Suite** | 7 automated HTTP checks | **100% PASS** |
| **Git History Secret Scan** | Full repository history | **0 secrets detected** |

```bash
# Run complete local verification gates
npm run check

# Run automated smoke test against running service
npx tsx scripts/smoke.ts
```

---

## 💻 Local Setup & Prerequisites

### Prerequisites
- **Node.js:** `>= 22.0.0` (tested on `v22.17.0`).
- **Native Addon Note (`D0` · `better-sqlite3`):**
  - `better-sqlite3@13.0.3` includes `binding.gyp`. When installing on native Windows, ensure [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **"Desktop development with C++"** workload and Python 3.10+ are installed.
  - *Zero-Toolchain Alternative:* Run via **Docker** (`docker build -t churnrescue-ai .`), **WSL2 Ubuntu**, or access the hosted [Google Cloud Run Demo](https://churnrescue-ai-550444407405.us-central1.run.app).

### Setup Instructions
1. **Clone repository:**
   ```bash
   git clone https://github.com/Abhinav-2002/churnrescue-ai.git
   cd churnrescue-ai
   ```
2. **Install dependencies:**
   ```bash
   npm ci
   ```
3. **Configure environment:**
   ```bash
   cp .env.example .env
   # Add your PayPal Sandbox credentials and Google Cloud project
   ```
4. **Start local development server:**
   ```bash
   npm run dev
   # Open http://localhost:3000/dashboard
   ```

---

## 📚 Documentation Index

- **[Judge & Evaluator Guide (`docs/JUDGE_GUIDE.md`)](docs/JUDGE_GUIDE.md)** — 3-minute guided walkthrough of all 4 core paths.
- **[Claims & Evidence Matrix (`docs/CLAIMS.md`)](docs/CLAIMS.md)** — Every architectural, guardrail, and payment claim mapped to exact code locations.
- **[System Architecture (`docs/ARCHITECTURE.md`)](docs/ARCHITECTURE.md)** — Mermaid diagrams for LangGraph, PayPal checkout, and Dashboard v2.
- **[Financial & Policy Invariants (`docs/INVARIANTS.md`)](docs/INVARIANTS.md)** — Formal specification of money, ladder, usage, and zero-PII invariants.
- **[Testing & Mutation Proofs (`docs/TESTING.md`)](docs/TESTING.md)** — 266 tests across 35 files, mutation proofs, and smoke tests.
- **[PayPal v6 Integration Review (`docs/PAYPAL_REVIEW.md`)](docs/PAYPAL_REVIEW.md)** — Atomic order claiming, idempotency, and pre-capture verification.
- **[Cloud Run Deployment Guide (`docs/DEPLOY_CLOUD_RUN.md`)](docs/DEPLOY_CLOUD_RUN.md)** & **[Operations Runbook (`docs/RUNBOOK.md`)](docs/RUNBOOK.md)**.
- **[Submission Screenshots Guide (`docs/SCREENSHOTS.md`)](docs/SCREENSHOTS.md)** & **[Release Notes (`docs/RELEASE_NOTES.md`)](docs/RELEASE_NOTES.md)**.

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

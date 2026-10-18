# ChurnRescue AI — Release Notes (`v1.0.0`)

**Release Date:** October 18, 2026  
**Tag:** `v1.0.0` (superseding `v0.9-rc1`)  
**Repository:** `https://github.com/Abhinav-2002/churnrescue-ai`

---

## 1. Executive Summary

`v1.0.0` completes the **ChurnRescue AI** autonomous subscription payment-recovery agent, deterministic policy guardrail engine, PayPal Checkout v6 + Orders v2 Sandbox integration, Dashboard v2 zero-PII analytics contract, multi-visitor demo isolation (`Stage R1`), production hardening (`Stage R2`), Cloud Run containerization (`Stage R3`), automated post-deploy smoke verification (`Stage R4`), comprehensive documentation (`Stage R5`), and submission assets (`Stage R6`).

---

## 2. Highlights by Stage & Fix Pack

### Release Candidate (`v0.9-rc1` — Fix Packs 1–9)
- **Deterministic Concession Ladder (`src/lib/agent/guardrails.ts`):**
  - Enforced strict 3-step concession ladder (`20% → 35% → 50%` floor) for low-usage accounts (`usage_percent < 60%`) and full-price retry / downgrade for high-usage accounts (`usage_percent >= 60%`).
  - Removed price/discount fields from `proposalSchema` (`src/lib/agent/llm.ts`) so the LLM cannot invent discounts.
  - Enforced outgoing reply amount validation (`checkMessageAmounts()`) and deterministic templates (`src/lib/agent/templates.ts`).
- **Conversational State Machine Fixes (`E1`–`E5`):**
  - **`E1` (Fix Pack 9):** Prevented premature pause-completion claims when `nextStep === "confirm_pause"` via deterministic phrase rejection (`src/lib/agent/graph.ts:266-273, 331`) and safe fallback (`"I can help you pause your subscription. Please click Confirm Pause below to proceed. Your subscription has not been paused yet."`).
  - **`E2` (Fix Pack 8):** Preserved the active offer and `ladder_step` when a customer asks a billing question at the discount floor (`intent === "question"`).
  - **`E3` (Fix Pack 8):** Marked open offers `declined` without advancing the ladder or showing PayPal checkout when a customer declines (`intent === "decline"`).
  - **`E4`:** Verified pause request at the `50%` discount floor transitions cleanly to `confirm_pause`.
  - **`E5`:** Preserved the active `pending` offer and `ladder_step` when a customer accepts via chat (`intent === "accept"`).
  - **Turn-4 Floor Pushback Escalation:** Escalated customer to `human_queue` (`repeat_pushback`, `Low` severity) on a 4th price pushback after `ladder_step === 2`.
- **Concurrency & Payment Integrity (`D4`, `D5`, `D7`):**
  - **`D4`:** Atomic SQLite claim (`paypal_order_id = 'CLAIMING:' || ? WHERE paypal_order_id IS NULL`) preventing duplicate PayPal order creation under concurrent requests (`src/lib/agent/tools.ts`).
  - **`D5`:** Included `declined` and `superseded` offers when computing the highest prior `ladder_step`.
  - **`D7`:** Preserved `ladder_step` and rotated `PayPal-Request-Id` (`offer_retry_${replacementOfferId}`) when creating a replacement offer after `INSTRUMENT_DECLINED`.

### Stage R1 (`r1-judge`) — Judge-Proof Demo & Multi-Visitor Isolation
- **Global Reset Protection (`src/lib/demo.ts`, `src/app/api/reset/route.ts`):** `POST /api/reset` returns `403` (`{"error": "hosted_reset_disabled"}`) when `HOSTED_DEMO=1` unless `ALLOW_GLOBAL_RESET=1`.
- **Per-Customer Reset (`src/app/api/demo/reset-customer/route.ts`):** Resets only a single customer's offers, actions, conversations, and non-original billing events in a single SQLite transaction.
- **Sample History Isolation (`is_sample`):** Added `is_sample INTEGER NOT NULL DEFAULT 0` migration across `billing_events`, `offers`, `agent_actions`, and `recoveries`, `POST /api/demo/sample` (`load`/`clear`), and `/dashboard` `Live` vs. `Live + sample` toggle (`?include_sample=0|1`).
- **Truthful Guardrails Panel (`src/components/dashboard/GuardrailsPanel.tsx`, `src/app/api/dashboard/metrics/route.ts`):** Replaced the legacy `Discount Capped` label with `Concession Ladder` and updated `getGuardrailCategory()` to count code-assigned ladder discounts (`Code ladder assigned X% discount (step Y)`).
- **Guided Evaluator Bar:** Added the 4-path **"Try it in 3 minutes"** bar on `/dashboard` and `/admin`.

### Stage R2 (`r2-hardening`) — Production Hardening, Security & Observability
- **Startup Config Validation (`src/lib/config.ts`):** Zod validation logging variable **names** only on failure—never secret values.
- **Structured Redacting Logger (`src/lib/logger.ts`):** JSON logs with automatic recursive redaction of secrets, tokens, emails, prompts, and customer messages.
- **Health & Readiness Probes (`src/app/api/health/route.ts`, `src/app/api/ready/route.ts`):** Liveness and SQLite `SELECT 1` readiness checks + `SIGTERM` `closeDb()` shutdown handler.
- **Security Headers & CSP (`next.config.ts`):** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and PayPal v6 `Content-Security-Policy-Report-Only`.
- **LLM Timeout, Retry & Deterministic Fallback (`src/lib/agent/llm.ts`, `src/lib/agent/graph.ts`):** `LLM_TIMEOUT_MS` timeout, 1 retry on transient error, and deterministic fallback (`outcome_code: "llm_fallback_used"`).

### Stage R3 (`r3-cloudrun`) — Cloud Run Containerization & Runtime Config
- **Runtime Client Config (`src/app/api/config/route.ts`, `src/components/ChatWidget.tsx`):** Serves public `paypalClientId` at runtime so Docker images do not require `NEXT_PUBLIC_PAYPAL_CLIENT_ID` baked at build time.
- **Multi-Stage Standalone `Dockerfile`:** Builds on `node:22-bookworm-slim`, runs as non-root `nextjs` user on `PORT=8080` with `SQLITE_PATH="/tmp/data.db"`.

### Stages R4–R6 — Automated Smoke Suite, Documentation & Submission Assets
- **7-Gate Smoke Verification (`scripts/smoke.ts`, `docs/POST_DEPLOY_CHECKLIST.md`):** Automated HTTP verification of `/api/health`, `/api/ready`, `/api/config`, `/api/dashboard/metrics` (15 keys + zero-PII scan), `/api/debug` (`404`), and isolated `c_5` start/reset cycle.
- **Documentation & Submission Package:** `README.md`, `docs/CLAIMS.md`, `docs/ARCHITECTURE.md`, `docs/INVARIANTS.md`, `docs/TESTING.md`, `docs/JUDGE_GUIDE.md`, `docs/MANUAL_TEST_PLAN.md`, `docs/PAYPAL_REVIEW.md`, `docs/RUNBOOK.md`, `docs/DEPLOY_CLOUD_RUN.md`, `docs/VIDEO_SCRIPT.md`, `docs/SCREENSHOTS.md`, and `docs/SUBMISSION.md`.

---

## 3. Verification Summary (`v1.0.0`)

- **TypeScript (`tsc --noEmit`):** `0` errors
- **ESLint (`npm run lint`):** `0` errors, `0` warnings
- **Vitest (`vitest run`):** `35` test files passed, `266` tests passed
- **Next.js Standalone Build (`npm run build`):** `PASS`
- **Smoke Suite (`npx tsx scripts/smoke.ts`):** `7/7` gates `PASS`
- **Git History Secret Scan:** `0` secret exposures

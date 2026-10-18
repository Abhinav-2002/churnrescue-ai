# ChurnRescue AI — Hackathon Submission Pack (`docs/SUBMISSION.md`)

This document consolidates the submission copy, architecture highlights, verification evidence, and final pre-submission checklist for **ChurnRescue AI**.

---

## 1. Project Title & Tagline

- **Title:** ChurnRescue AI
- **Tagline:** Autonomous, guardrail-enforced payment recovery at the point of experience—combining Google Cloud Vertex AI (`gemini-3.5-flash-lite`), LangGraph deterministic policy guardrails, and PayPal Checkout v6 Sandbox.

---

## 2. Elevator Pitch & Problem Statement

SaaS companies lose up to 9% of recurring revenue to involuntary churn and failed renewals. Standard dunning emails have low engagement, while unconstrained AI billing chatbots introduce unacceptable risk: they can hallucinate arbitrary discounts, promise $10 plans on $150 accounts, claim an account is paused before database state changes, or fail to escalate chargeback/legal disputes.

**ChurnRescue AI** solves this by separating **conversational empathy & intent classification** (powered by **Google Cloud Vertex AI `gemini-3.5-flash-lite`**) from **deterministic financial & policy authority** (enforced in TypeScript + SQLite + **PayPal Orders v2**):
- **The LLM cannot propose prices:** `proposalSchema` excludes discount fields entirely. Discounts (`20% → 35% → 50%` floor) are assigned deterministically by code based on `ladderStep`.
- **High-usage protection:** Customers using $\ge 60\%$ of plan capacity (`PARTIAL_CREDIT_MAX_USAGE_EXCLUSIVE = 60`) are deterministically blocked from discounts and routed to full-price retry or plan downgrade.
- **Outgoing reply validator (`checkMessageAmounts`):** Every dollar amount in an LLM response is verified against stored offer cents; any hallucinated amount or premature `"lowest rate"` claim is replaced by a deterministic template.
- **Two-step pause confirmation (`E1`) & compliance keyword escalation:** Pause requests require explicit user confirmation (`POST /api/agent/confirm-pause`), and dispute/chargeback/legal/fraud keywords trigger immediate handoff to the **Needs a Human** queue.
- **End-to-end PayPal Checkout v6 + Orders v2 Sandbox verification:** Atomic SQLite order claiming (`D4`), `PayPal-Request-Id` idempotency, pre-capture amount/currency verification (`D1`/`D2`), and `INSTRUMENT_DECLINED` retry preservation (`D7`).

---

## 3. Technical Stack

- **Frontend:** Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS v4, `@paypal/react-paypal-js/sdk-v6` (`PayPalProvider`, `PayPalOneTimePaymentButton`).
- **Agent & Orchestration:** LangGraph (`@langchain/langgraph`), Google Cloud Vertex AI (`@langchain/google-vertexai`, `gemini-3.5-flash-lite` on `aiplatform.googleapis.com`), Zod v4 structured output & schema validation.
- **Payments:** PayPal Orders v2 REST API (`https://api-m.sandbox.paypal.com`), PayPal Agent Toolkit (`@paypal/agent-toolkit`), Webhook Signature Verification (`/v1/notifications/verify-webhook-signature`).
- **Persistence & Deployment:** SQLite WAL (`better-sqlite3`), Multi-stage Debian `node:22-bookworm-slim` standalone `Dockerfile` for **Google Cloud Run**.

---

## 4. Key Engineering Challenges Solved (`D1`–`D7` & `E1`–`E5`)

1. **Atomic PayPal Order Claiming (`D4`):** Prevented duplicate PayPal orders under concurrent requests using an atomic conditional SQLite `UPDATE ... WHERE paypal_order_id IS NULL` claim with a 5-minute stale-claim recovery window.
2. **Pre-Capture & Post-Capture Amount Verification (`D1`, `D2`, `D7`):** Verified order amount and `USD` currency via `GET /v2/checkout/orders/:id` before capture, ignored client-supplied amounts, and preserved `ladder_step` when creating a replacement offer after `422 INSTRUMENT_DECLINED`.
3. **Real-Model Conversational Edge Cases (`E1`–`E5`):**
   - `E1`: Enforced deterministic validation so pause offers never claim the subscription is already paused before the user clicks **Confirm Pause**.
   - `E2`: Preserved active discount offers when customers ask billing questions at the `50%` floor.
   - `E3`: Marked open offers `declined` (instead of leaving them `pending` or pushing checkout) when a customer politely declines.
   - `E4`: Allowed clean switching from the `$12.50` discount floor to a `0`-cent `pause` offer.
   - `E5`: Preserved `pending` offer state and `ladder_step` when a customer verbally accepts in chat before clicking PayPal.
4. **Judge-Proof Multi-Visitor Demo Isolation (`Stage R1`):** Locked global sandbox reset (`403 hosted_reset_disabled`) when `HOSTED_DEMO=1`, added per-customer reset (`POST /api/demo/reset-customer`), and isolated synthetic 14-day sample history (`is_sample = 1`) from live metrics and PayPal capture routes.

---

## 5. Verification Evidence Summary

- **Live Deployed Cloud Run URL:** `https://churnrescue-ai-550444407405.us-central1.run.app` (Service `churnrescue-ai`, Region `us-central1`, Revision `churnrescue-ai-00002-645`).
- **Automated Test Suite:** `35` test files, `266` passing tests (`npm run check`).
- **Live PayPal Sandbox Capture Proof:** Order `3LG77311TG3677635`, Capture `81485234NB008850W` (`COMPLETED`, `150.00 USD`) for Hannah Abbott (`c_8`), reconciled 1-to-1 with SQLite `recoveries` (`15000` cents) and `/dashboard` (`$150.00` Recovered Revenue); Cloud Run live PayPal Sandbox order `86118971MG8639138` verified for idempotency and pre-capture status enforcement.
- **Live Vertex AI Ladder & Escalation Proof:** Alice (`c_1`) verified across `2000` $\to$ `1625` $\to$ `1250` cents (`ladder_step` `0` $\to$ `1` $\to$ `2`) and Turn-4 `repeat_pushback` escalation; Diana (`c_4`) verified in `human_queue` (`chargeback`, `High`, `$50.00`).
- **Automated Smoke Suite (`scripts/smoke.ts`):** All 7 post-deploy HTTP gates passing against `https://churnrescue-ai-550444407405.us-central1.run.app` (`200` on `/api/health`, `/api/ready`, `/api/config`, `/api/dashboard/metrics`, `404` on `/api/debug`, and isolated E2E flow on `c_5`).

---

## 6. Final Pre-Submission Checklist

- [x] `npm run check` passes (`0` TypeScript errors, `0` ESLint errors, `35/35` test files, `266/266` tests).
- [x] `npm run build` succeeds with `output: "standalone"`.
- [x] Deployed to Google Cloud Run (`https://churnrescue-ai-550444407405.us-central1.run.app`) with dedicated least-privilege runtime service account (`churnrescue-ai@project-03a4bace-4744-4fab-bc9.iam.gserviceaccount.com`) and Secret Manager (`PAYPAL_CLIENT_SECRET`).
- [x] `npx tsx scripts/smoke.ts` passes all 7 gates against `https://churnrescue-ai-550444407405.us-central1.run.app`.
- [x] Zero secrets, `.env` files, or PayPal credentials committed in Git history (`git log -S` scan clean).
- [x] Documentation complete: `README.md`, `docs/JUDGE_GUIDE.md`, `docs/CLAIMS.md`, `docs/ARCHITECTURE.md`, `docs/INVARIANTS.md`, `docs/TESTING.md`, `docs/MANUAL_TEST_PLAN.md`, `docs/PAYPAL_REVIEW.md`, `docs/RUNBOOK.md`, `docs/DEPLOY_CLOUD_RUN.md`, `docs/POST_DEPLOY_CHECKLIST.md`, `docs/VIDEO_SCRIPT.md`, `docs/SCREENSHOTS.md`, `docs/SUBMISSION.md`, and `docs/RELEASE_NOTES.md`.
- [x] Captured motion-graphics demo video (`churnrescue-ai-demo.mp4` / `.webm`) following [`docs/VIDEO_SCRIPT.md`](VIDEO_SCRIPT.md).
- [x] Captured 8 screenshots (`01`–`08`) following [`docs/SCREENSHOTS.md`](SCREENSHOTS.md).
- [ ] Submit repository URL (`https://github.com/Abhinav-2002/churnrescue-ai`), deployed Cloud Run URL (`https://churnrescue-ai-550444407405.us-central1.run.app`), demo video, and submission text on the hackathon portal.

# ChurnRescue AI — Operations & Production Runbook (`docs/RUNBOOK.md`)

This runbook covers startup configuration validation, health/readiness probes, LLM timeout/fallback operations, Vertex AI model-retirement checkpoints, structured logging, and dependency auditing.

---

## 1. Startup Configuration (`src/lib/config.ts`)

At startup and readiness checks, [`validateConfig()`](../src/lib/config.ts) validates the following environment variables via Zod:

| Variable | Required | Default | Constraint |
|---|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | Yes | — | Non-empty GCP Project ID (`project-03a4bace-4744-4fab-bc9`) |
| `GOOGLE_CLOUD_LOCATION` | Yes | `global` | Vertex AI endpoint region (`global`) |
| `LLM_MODEL` | Yes | `gemini-3.5-flash-lite` | Vertex AI Gemini model ID |
| `PAYPAL_CLIENT_ID` | Yes | — | PayPal Sandbox REST App Client ID |
| `PAYPAL_CLIENT_SECRET` | Yes | — | PayPal Sandbox REST App Secret (server-only) |
| `PAYPAL_BASE_URL` | Yes | — | Strictly `https://api-m.sandbox.paypal.com` |
| `DEMO_MODE` | No | `0` | `'0'` or `'1'` (enables `/api/simulate-failure`, `/api/demo/*`) |
| `HOSTED_DEMO` | No | `0` | When `'1'`, blocks global `POST /api/reset` with HTTP `403` |
| `SQLITE_PATH` | No | `data.db` | Path to SQLite database file (or `/tmp/data.db` in containers) |
| `APP_BASE_URL` | No | Derived | Public origin used for PayPal `return_url` / `cancel_url` |

- **Safe Failure Reporting:** If validation fails, `assertStartupConfig()` throws an error listing **only variable names** (`missingOrInvalidKeys`), never variable values or secret prefixes.

---

## 2. Health, Readiness & Graceful Shutdown

- **Liveness Probe (`GET /api/health`):**
  - Returns HTTP `200` with `{"status": "ok", "uptime_s": <number>, "timestamp": "<ISO>"}`.
- **Readiness Probe (`GET /api/ready`):**
  - Executes `SELECT 1 as ok` against SQLite and runs `validateConfig()`.
  - Returns HTTP `200` `{"status": "ready", "db": "ok", "config": "ok"}` when healthy, or HTTP `503` `{"status": "not_ready", "db": "...", "config": "...", "missingOrInvalidKeys": [...]}` when unhealthy.
- **Graceful Shutdown (`SIGTERM`):**
  - [`src/lib/db.ts`](../src/lib/db.ts) registers a `process.once('SIGTERM')` listener that invokes `closeDb()` to flush WAL checkpoints and close the SQLite file descriptor cleanly on container stop.

---

## 3. Vertex AI LLM Resilience & Model-Retirement Schedule

### Timeout, Retry & Deterministic Fallback (`src/lib/agent/llm.ts`, `src/lib/agent/graph.ts`)
- On first model initialization, `logLlmStartupOnce()` emits a single structured JSON event naming `llm_model` and `google_cloud_location`.
- Every LLM call (`decide` and `compose_message`) is wrapped in `invokeWithTimeoutAndRetry()` with a configurable timeout (`LLM_TIMEOUT_MS`, default `15000`ms) and `1` automatic retry.
- If Vertex AI is unreachable or times out after retry:
  - `decide` falls back to `inferFallbackIntent()` and emits a structured log with `outcome_code: "llm_fallback_used"`.
  - `compose_message` falls back to the deterministic state-correct template (`templateUsed.used = true`) and emits `outcome_code: "llm_fallback_used"`.
  - All guardrail and money invariants remain 100% enforced even during a complete LLM outage.

### Scheduled Model-Retirement Checkpoints
Operators must verify Vertex AI model availability and alias stability on the following scheduled dates:
1. **Oct 19 (Checkpoint 1):** Verify `gemini-3.5-flash-lite` availability on `aiplatform.googleapis.com` (`location=global`) and run `npm run check`.
2. **Nov 1 (Checkpoint 2):** Check Google Cloud Vertex AI release notes and model lifecycle tables for any deprecation notices affecting `gemini-3.5-flash-lite`.
3. **Nov 10 (Checkpoint 3):** Pre-judging final model check; if `LLM_MODEL` requires rotation to a newer GA Gemini model ID, update the `LLM_MODEL` Cloud Run environment variable without code changes and re-run `scripts/smoke.ts`.

---

## 4. Structured Logging & Redaction (`src/lib/logger.ts`)

- `buildStructuredLog()` / `logRequest()` emit single-line JSON entries with:
  - `timestamp`, `requestId`, `route`, `status`, `latency_ms`, `outcome_code`, `llm_latency_ms`.
- **Automatic Redaction:**
  - Any metadata keys matching `prompt`, `text`, `message`, `email`, `paypal_body`, `token`, `secret`, `authorization`, `password`, or `reasoning` are replaced with `"[REDACTED]"`.
  - Free-text strings are scrubbed for email addresses (`[REDACTED_EMAIL]`), `Bearer` tokens (`Bearer [REDACTED_TOKEN]`), `Basic` auth headers (`Basic [REDACTED_AUTH]`), and PayPal/GCP token prefixes (`[REDACTED_SECRET]`).

---

## 5. Security Headers & CSP (`next.config.ts`)

Every response includes:
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: SAMEORIGIN`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Content-Security-Policy-Report-Only`: Permits `'self'`, `https://*.paypal.com`, and `https://*.paypalobjects.com` across `script-src`, `frame-src`, `connect-src`, and `img-src` in accordance with PayPal JS SDK v6 CSP documentation.

---

## 6. Dependency Audit & License Summary

### Production Audit (`npm audit --omit=dev`)
- Direct production dependencies (`next@16.2.2`, `react@19.2.4`, `better-sqlite3@13.0.3`, `@langchain/google-vertexai@2.1.26`, `@langchain/langgraph@1.2.8`, `zod@4.3.6`, `lucide-react@1.16.0`, `dotenv@17.4.1`) have **0 direct vulnerabilities**.
- Transitive advisories reported by `npm audit --omit=dev` (10 advisories in `@ai-sdk/provider-utils`, nested `@langchain/core`, `jsondiffpatch`, `langsmith`, `mathjs`, `uuid`) originate exclusively inside `@paypal/agent-toolkit`'s bundled dependency tree.
- **Mitigation:** ChurnRescue AI does not invoke `@paypal/agent-toolkit`'s `@ai-sdk/react` UI helpers, `jsondiffpatch` HTML formatter, `mathjs` expression parser, or LangSmith prompt pull; live PayPal order creation and capture execute through direct server-side `fetch` calls in [`src/lib/paypal.ts`](../src/lib/paypal.ts).

### License Summary
All direct production and development dependencies use permissive open-source licenses compatible with commercial and hackathon distribution:
- **MIT:** `next`, `react`, `react-dom`, `better-sqlite3`, `@langchain/*`, `lucide-react`, `zod`, `tailwindcss`, `vitest`, `@testing-library/*`
- **Apache-2.0:** `@paypal/agent-toolkit`, `typescript`
- **BSD-2-Clause:** `dotenv`

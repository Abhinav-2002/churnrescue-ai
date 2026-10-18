# ChurnRescue AI — Testing, Mutation Proofs & Evaluation Guide (`docs/TESTING.md`)

ChurnRescue AI includes **266 automated tests across 35 test suites**, mutation proofs for critical concurrency and state-machine defects (`D4`, `D5`, `D7`), a live Vertex AI evaluation harness (`scripts/eval-real.ts`), and a 7-gate post-deploy HTTP smoke suite (`scripts/smoke.ts`).

---

## 1. Automated Test Suite (`npm run check`)

Run the full verification gate (TypeScript `tsc --noEmit`, ESLint, and Vitest):

```bash
npm run check
```

### Key Test Suites by Domain:

| Test File | Coverage Area |
|---|---|
| `tests/guardrails.test.ts` | Pure guardrail policy rules (`<60%` vs `>=60%` usage, concession ladder caps, keyword escalations, repeat cancel) |
| `tests/validator.test.ts` | Outgoing message validator (`checkMessageAmounts`, hallucinated price rejection, premature `"lowest rate"` rejection) |
| `tests/flow_edge_cases.test.ts` | Conversational edge cases `E1` (pause confirmation wording), `E2` (question at floor), `E3` (decline), `E4` (pause at floor), `E5` (accept via chat), and Turn-4 floor pushback escalation |
| `tests/e2_e3.test.ts` | Regression suite for `E2` (billing questions preserve active offer) and `E3` (declining offer marks offer `declined` without pushing checkout) |
| `tests/defect4.test.ts` | `D4` Atomic SQLite claim preventing duplicate PayPal orders under concurrent `createOrderInternal` calls |
| `tests/defect5.test.ts` | `D5` Preserving `ladder_step` across declined offers |
| `tests/defect7.test.ts` | `D7` Preserving `ladder_step` and generating a fresh `PayPal-Request-Id` when retrying after `INSTRUMENT_DECLINED` |
| `tests/capture.test.ts` & `tests/capture_verify.test.ts` | Pre-capture and post-capture PayPal Order v2 verification, amount tampering rejection, idempotent replay, and network-drop reconciliation |
| `tests/metrics.test.ts` & `tests/policy_audit.test.ts` | Dashboard API v2 contract, 15 top-level keys, zero-PII scan, `recovered <= failed`, nested-set funnel monotonicity, delta suppression (`<3` prior events), and `auditOffer()` |
| `tests/dashboard_ui.test.tsx` & `tests/fixpack.test.tsx` | React Testing Library UI tests for KPI cards, GuardrailsPanel truthful copy, Needs a Human queue, CustomerDrawer focus trap/`Escape`, and accessibility tables |
| `tests/r1_judge.test.ts` | Stage R1 `HOSTED_DEMO=1` global reset lock (`403`), `/api/demo/reset-customer` isolation, legacy DB migration for `is_sample`, sample history isolation, and multi-tab concurrency |
| `tests/r2_hardening.test.ts` | Stage R2 startup config validation (names only on failure), redacting logger unit tests, `/api/health`, `/api/ready`, `closeDb()`, PayPal v6 CSP headers, LLM retry, and `/api/debug` `404` |
| `tests/r3_cloudrun.test.ts` | Stage R3 `/api/config` runtime PayPal Client ID (zero secret exposure) and `Dockerfile` / `.dockerignore` invariants |

---

## 2. Mutation Proofs (`D4`, `D5`, `D7` & Turn-4 Escalation)

To prove our regression tests catch real regressions on assertion failures (and do not pass vacuously), each critical fix was verified by reverting the production guard in an isolated git worktree and confirming the corresponding test fails on the exact expected assertion:

1. **`D4` Mutation Proof (`src/lib/agent/tools.ts`):**
   - *Mutation:* Bypass the atomic `UPDATE offers SET order_claimed_at = ? ...` claim check (`if (false)`).
   - *Result:* `tests/defect4.test.ts` **FAILS** with `AssertionError: expected "createOrder" to be called 1 times, but got 2 times`.
2. **`D5` Mutation Proof (`src/lib/agent/graph.ts`):**
   - *Mutation:* Filter `getPreviousLadderStep` by `AND status = 'accepted'` so declined offers are ignored.
   - *Result:* `tests/defect5.test.ts` **FAILS** with `AssertionError: expected 0 to be 1` (`ladder_step` reset to `0` instead of advancing to `1`).
3. **`D7` Mutation Proof (`src/app/api/offers/[offerId]/capture/route.ts`):**
   - *Mutation:* Omit replacement offer creation on `422 INSTRUMENT_DECLINED`.
   - *Result:* `tests/defect7.test.ts` **FAILS** with `AssertionError: expected undefined to be defined` (no replacement offer at the preserved `ladder_step`).
4. **Turn-4 Floor Pushback Mutation Proof (`src/lib/agent/guardrails.ts`):**
   - *Mutation:* Remove the `previousLadder >= 2 && intent === 'negotiate'` escalation rule.
   - *Result:* `tests/flow_edge_cases.test.ts` **FAILS** with `AssertionError: expected 'partial_credit' to be 'escalate'`.

---

## 3. Live Vertex AI Evaluation (`npm run eval:real`)

[`scripts/eval-real.ts`](../scripts/eval-real.ts) runs multi-turn conversations against the real Google Cloud Vertex AI model (`gemini-3.5-flash-lite`) using an isolated temporary SQLite database (never touching `data.db`). It is guarded by `RUN_REAL_EVAL=1` so it never runs accidentally in CI:

```powershell
$env:RUN_REAL_EVAL = "1"
npm run eval:real
```

---

## 4. Post-Deploy Smoke Suite (`scripts/smoke.ts`)

Run the 7-gate HTTP smoke suite against a running local or Cloud Run server:

```powershell
$env:SMOKE_BASE_URL = "http://localhost:3000"
npx tsx scripts/smoke.ts
```

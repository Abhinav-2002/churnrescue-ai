# Defect Register

| ID | Severity | Area | Reproduction | Observed | Expected | Root cause file:line | Status |
|---|---|---|---|---|---|---|---|
| D0 | P1 | Ops | Run `npm ci` on Windows with Node 22 without Visual Studio Build Tools. | Fails in `node-gyp rebuild` for `better-sqlite3`. No prebuilt binary is downloaded for this platform/version. | Installation completes successfully using a prebuilt binary or gracefully warns. | `package.json` (better-sqlite3 13.0.3 prebuild missing for node 22 on win32). | UNVERIFIED (code reading/logs) |
| D1 | P1 | Policy | Run `npx tsx eval_d1.ts` to trace the proactive offer -> pushback -> pushback negotiation. | Model proposes `retry`. Guardrail hardcodes amount to $25.00, ignoring previous discount ladder. | Amount decreases or stays same with a pause option, never increasing. | `src/lib/agent/guardrails.ts:125` | Open (RED test in `eval_d1.ts`) |
| D2 | P1 | Concurrency | Run two concurrent `/api/agent/start` requests. | Two identical first messages are stored and rendered. | Exactly one first message is stored and returned. | `src/app/api/agent/start/route.ts:18` | Open (RED test in `tests/problem.test.ts`) |
| D3 | P2 | UI | Run `npx vitest run tests/defect3.test.ts`. | "Telemetry connection stale" amber banner appears on 304 Not Modified. | Amber banner only appears on true disconnects. | `src/lib/hooks/useMetricsPolling.ts:51` | Open (RED test in `tests/defect3.test.ts`) |
| D4 | P1 | Concurrency | Run `npx vitest run tests/defect4.test.ts`. | Two concurrent `messagePOST` accepts overwrite `paypal_order_id`, causing the first order to be uncapturable (stuck checkout). | Only one PayPal order is generated; the second fails or returns the same order. | `src/lib/agent/graph.ts:101` | Open (RED test in `tests/defect4.test.ts`) |
| D5 | P1 | Policy | Run `npx vitest run tests/defect5.test.ts`. | Declining an offer filters it out of `getPreviousLadderStep`, resetting the ladder step to 0 on the next message. | The ladder step preserves history and never decreases. | `src/lib/agent/graph.ts:40` | Open (RED test in `tests/defect5.test.ts`) |
| D7 | P1 | Edge Case | Code reading: PayPal capture fails (e.g. `INSTRUMENT_DECLINED`). | Offer status is set to `failed`. Subsequent `accept` ignores the failed offer, leaving the customer stuck with no new order. | A new order is generated or the offer is reset to pending. | `src/app/api/offers/[offerId]/capture/route.ts:89` | UNVERIFIED (code reading) |

## Non-Defects (Proved Secure)
* **Two simultaneous captures**: `tests/defects_probe.test.ts` proves that atomic `UPDATE ... WHERE status = 'accepted'` safely returns 409 Conflict for the second request. No double charge possible.
* **Amount mismatch**: Code reading proves that if the PayPal order amount differs from the DB amount, capture is blocked and status is safely updated to `needs_review`.
* **Bad LLM_MODEL**: Code reading proves `Promise.race` and `try/catch` catch model failures and return a safe generic reply without corrupting DB state.
* **Daily LLM budget exhausted**: Code reading proves `tryConsumeLlmRun` correctly halts execution and returns `BUSY_REPLY`.
* **DEMO_MODE off (404s)**: Retracted false-positive D6. `isDemoMode()` is correctly utilized in admin routes to block production abuse.
* **Expired offer**: Code reading proves expired offers are rejected, though they currently return to `accepted` which may stick the checkout (noted as part of D7 flow).

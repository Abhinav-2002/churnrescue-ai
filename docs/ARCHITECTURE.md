# ChurnRescue AI — System Architecture (`docs/ARCHITECTURE.md`)

## 1. High-Level System Architecture

```mermaid
flowchart TD
    subgraph Client["Browser Client (Next.js 16 React 19)"]
        AdminUI["/admin — Simulation & Per-Customer Reset"]
        ChatUI["ChatWidget + PayPal JS SDK v6 Button"]
        DashUI["/dashboard — Real-Time Operations Dashboard v2"]
    end

    subgraph NextServer["Next.js 16 App Router Server (Node 22)"]
        StartAPI["POST /api/agent/start"]
        MsgAPI["POST /api/agent/message"]
        PauseAPI["POST /api/agent/confirm-pause"]
        CaptureAPI["POST /api/offers/:offerId/capture"]
        MetricsAPI["GET /api/dashboard/metrics"]
        DemoAPI["POST /api/demo/reset-customer & /api/demo/sample"]
        HealthAPI["GET /api/health & /api/ready & /api/config"]
    end

    subgraph LangGraph["LangGraph Deterministic Retention Engine (src/lib/agent/graph.ts)"]
        N1["1. load_context (Customer & Active Offer)"]
        N2["2. decide (Vertex AI Intent + Tone Proposal)"]
        N3["3. validate_guardrails (Pure Policy & Ladder Enforcement)"]
        N4["4. persist_and_execute (SQLite Offer + Atomic PayPal Order Claim)"]
        N5["5. compose_message (Vertex AI Reply + Amount/Claim Validator)"]
        N1 --> N2 --> N3 --> N4 --> N5
    end

    subgraph External["External Services & Storage"]
        SQLite[("SQLite WAL Database\n(customers, billing_events, offers,\nagent_actions, recoveries, conversations)")]
        VertexAI["Google Cloud Vertex AI\n(gemini-3.5-flash-lite, location=global)"]
        PayPal["PayPal Orders v2 Sandbox API\n(https://api-m.sandbox.paypal.com)"]
    end

    ChatUI --> StartAPI & MsgAPI & PauseAPI & CaptureAPI
    DashUI --> MetricsAPI & DemoAPI
    AdminUI --> DemoAPI
    StartAPI & MsgAPI --> N1
    N2 & N5 <-->|"Timeout + 1 Retry\n+ Deterministic Fallback"| VertexAI
    N3 & N4 & MetricsAPI & DemoAPI & PauseAPI & CaptureAPI <--> SQLite
    N4 & CaptureAPI <-->|"OAuth2 Cached Token +\nPayPal-Request-Id"| PayPal
```

---

## 2. LangGraph 5-Node Execution Pipeline (`src/lib/agent/graph.ts`)

Every customer turn (`POST /api/agent/start` or `POST /api/agent/message`) runs through a 5-node state graph:

1. **`load_context`:** Loads the customer's plan, `plan_price_cents`, `usage_percent`, and any active non-sample offer (`status IN ('pending', 'accepted') AND is_sample = 0`).
2. **`decide`:** Calls Vertex AI (`gemini-3.5-flash-lite`) with structured output (`intent` + `proposalSchema`).
   - `proposalSchema` deliberately excludes discount percentages and prices so the LLM can only classify intent (`negotiate`, `accept`, `decline`, `cancel`, `neutral`, `escalate`, `pause_request`, `question`) and suggest tone notes.
   - Wrapped in `callWithTimeoutAndRetry` (15s timeout + 1 retry). If Vertex AI fails, `inferFallbackIntent()` deterministically classifies the user's message and logs `outcome_code: "llm_fallback_used"`.
3. **`validate_guardrails`:** Pure deterministic policy engine (`validateProposal` in `src/lib/agent/guardrails.ts`):
   - Checks compliance/dispute keywords first (`detectEscalation()`).
   - Computes `ladderStep = nextLadderStep(previousLadder, intent)` (`0 -> 20%`, `1 -> 35%`, `2 -> 50%`).
   - Blocks `partial_credit` when `usage_percent >= 60%` (`PARTIAL_CREDIT_MAX_USAGE_EXCLUSIVE = 60`).
   - Escalates on pushback #4 (`previousLadder >= 2` + `intent === 'negotiate'`) or second cancel at high usage.
   - Preserves the active offer when `intent === 'question'` (`E2`) and marks the active offer `declined` when `intent === 'decline'` (`E3`).
4. **`persist_and_execute`:**
   - Supersedes prior open offers when creating a new offer or escalating.
   - Inserts the new `offers` row (`pending` or `accepted` on initial proactive offer) and calls `createOrderInternal(offerId)` to atomically claim and create a PayPal Order v2 when `amount_cents > 0`.
5. **`compose_message`:**
   - Generates natural-language reply via Vertex AI, sanitizes markdown/links (`sanitizeReply`), and validates every dollar figure in the reply with `checkMessageAmounts(lastMsg, required, allowed)` plus state-specific invariants (`question`, `decline`, `pause`, `escalate`).
   - If any invariant fails (or if the LLM timed out), replaces the reply with a deterministic, state-correct template and records `template_used: true` in `agent_actions.details_json`.

---

## 3. PayPal Checkout v6 + Orders v2 Sequence

```mermaid
sequenceDiagram
    participant User as Customer (ChatWidget)
    participant App as Next.js API Routes
    participant DB as SQLite (offers / recoveries)
    participant PP as PayPal Sandbox (Orders v2)

    User->>App: Start / Accept Offer
    App->>DB: Atomic UPDATE offers SET order_claimed_at = now WHERE paypal_order_id IS NULL
    App->>PP: POST /v2/checkout/orders (PayPal-Request-Id: offer_<id>)
    PP-->>App: { id: "ORDER_ID", status: "CREATED" }
    App->>DB: UPDATE offers SET paypal_order_id = "ORDER_ID", order_claimed_at = NULL
    App-->>User: Render PayPalOneTimePaymentButton (SDK v6)
    User->>PP: Approve Payment in PayPal Sandbox Popup
    User->>App: POST /api/offers/:offerId/capture
    App->>DB: Verify offer exists, is_sample = 0, matches ORDER_ID
    App->>PP: GET /v2/checkout/orders/ORDER_ID (Pre-capture amount & USD check)
    PP-->>App: { amount: { value: "150.00", currency_code: "USD" } }
    App->>PP: POST /v2/checkout/orders/ORDER_ID/capture
    PP-->>App: { status: "COMPLETED", captures: [{ amount: { value: "150.00" } }] }
    App->>DB: Transaction: offer='captured', event='recovered', customer='recovered', INSERT recovery
    App-->>User: { status: "captured", recovered_amount_cents: 15000 }
```

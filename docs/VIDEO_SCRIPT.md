# ChurnRescue AI — 3-Minute Demo Video Script (`docs/VIDEO_SCRIPT.md`)

**Target Duration:** `3:00` (`180 seconds`)  
**Resolution:** `1920×1080` (1080p, 60fps), browser zoom `100%`  
**Starting URL:** `/dashboard` (with Hannah `c_8` recovered at `$150.00` and Diana `c_4` in `Needs a Human`)

---

## Scene 1 (`0:00 – 0:25`) — Hook & Operations Dashboard v2

- **On Screen:**
  1. Open `/dashboard` showing the **ChurnRescue AI** header, `"Sandbox demo, no real money"` badge, **Live** indicator, and the **"Try it in 3 minutes — Guided Judge Walkthrough"** panel expanded.
  2. Briefly toggle **Live** $\to$ **Live + sample** to show the 14-day Failed vs. Recovered chart and `"Includes sample data"` breakdown banner, then switch back to **Live**.
  3. Scroll to **Guardrails at Work** showing **`100% Policy Compliance (0 violations)`** and `"Discounts deterministically assigned by the code concession ladder (20% → 35% → 50%); the model cannot propose prices."`
- **Narration:**
  > *"Involuntary churn and failed subscription renewals cost SaaS businesses up to 9% of MRR—yet letting a generative AI chatbot negotiate billing without deterministic guardrails is a financial liability. Meet ChurnRescue AI: an autonomous payment-recovery agent built on Next.js 16, LangGraph, Google Cloud Vertex AI Gemini, and PayPal Checkout v6. In ChurnRescue AI, the LLM handles empathy and intent classification, while deterministic code enforces every price, discount tier, and PayPal capture check."*

---

## Scene 2 (`0:25 – 1:15`) — Path 1: Deterministic Concession Ladder & Floor (`Alice`, `c_1`)

- **On Screen:**
  1. In the **"Try it in 3 minutes"** bar on `/dashboard`, click **Try Path** on **1. Discount Ladder + Floor (Alice)** (`Starter $25.00/mo`, `15%` usage).
  2. **Turn 1 (Proactive Greeting):** Show the agent's initial offer of **`$20.00`** (`20%` discount, `ladder_step: 0`).
  3. **Turn 2:** Type `"can you make it $10"` and press Enter.
     - Show the agent stepping to **`$16.25`** (`35%` discount, `ladder_step: 1`) without echoing `"$10"`.
  4. **Turn 3:** Type `"$10 i can afford"` and press Enter.
     - Show the agent reaching the **50% policy floor (`$12.50`, `ladder_step: 2`)**, stating `"best I can offer"`, and presenting the **pause** option.
  5. **Turn 4 (Edge Case `E2` — Question at Floor):** Type `"Wait, what is this charge for?"` and press Enter.
     - Show the agent explaining the Starter renewal while preserving the **`$12.50`** offer.
- **Narration:**
  > *"Let's test Path 1 with Alice, a low-usage Starter customer at $25 a month. Because her usage is 15%, the code concession ladder starts at step 0: $20.00. When she demands '$10', the model cannot propose or echo $10—our Zod proposalSchema doesn't even have a discount field, and our outgoing validator rejects any unauthorized dollar figure. Code advances her to step 1 at $16.25, and on her next pushback, reaches our 50% policy floor at $12.50 while offering a pause. Even if she asks a billing question at the floor, her $12.50 offer is preserved."*

---

## Scene 3 (`1:15 – 1:55`) — Path 2: High-Usage Guardrail & Live PayPal v6 Capture (`Hannah`, `c_8`)

- **On Screen:**
  1. Show **Hannah Abbott** (`c_8`, Enterprise `$150.00/mo`, `85%` usage).
  2. Highlight that because `usage_percent >= 60%`, `PARTIAL_CREDIT_MAX_USAGE_EXCLUSIVE = 60` deterministically blocks discounts and forces a full-price **`$150.00`** retry (`0%` discount).
  3. Click the **PayPal** button (`@paypal/react-paypal-js/sdk-v6`), approve the `$150.00` order in the PayPal Sandbox popup, and show the chat widget transitioning to **`Account Recovered — Captured: $150.00`**.
  4. Point to the dashboard KPI cards: **Recovered Revenue `$150.00`**, **Customers Recovered `1`**, **Recovery Funnel `Paid: 1` (`0 inconsistencies`)**.
- **Narration:**
  > *"Now look at Path 2: Hannah is on the $150 Enterprise plan with 85% usage. Because her usage is 60% or higher, our guardrail engine blocks partial credits and enforces a full-price $150 retry. When she clicks the PayPal v6 button, our server atomically claims the offer in SQLite, creates a PayPal Order v2 with an idempotent PayPal-Request-Id, and—before capturing—verifies the order ID, USD currency, and exact 15,000-cent amount against our database. Once captured, Recovered Revenue updates live to $150.00."*

---

## Scene 4 (`1:55 – 2:35`) — Path 3 (Two-Step Pause `E1`) & Path 4 (Chargeback Escalation)

- **On Screen:**
  1. Click **Try Path** on **3. Pause Confirmation (Charlie)** (`c_3`) and send `"Can I pause my subscription?"`.
  2. Point out the reply: *"Please click Confirm Pause below to proceed. Your subscription has not been paused yet."* Click **Confirm Pause** $\to$ status updates to **`Subscription Paused`**.
  3. Click **Try Path** on **4. Keyword Escalation (Diana)** (`c_4`) and send `"this is a chargeback"`.
  4. Show the immediate handoff message and scroll to the **Needs a Human** queue on `/dashboard`, showing **Diana Prince** (`Chargeback`, **`High`** severity, `$50.00`), then click **Review** to open the **Customer Decision Timeline Drawer** with the **Reset Customer Only** button.
- **Narration:**
  > *"In Path 3, when Charlie asks to pause, our E1 guardrail prevents the LLM from claiming the account is already paused—requiring an explicit Confirm Pause click before changing database state. And in Path 4, when Diana mentions a chargeback, keyword detection intercepts the turn before any offer can be made, supersedes open offers, and flags her in the Needs a Human queue with High severity. Clicking Review opens her full decision audit trail and lets evaluators reset a single customer without wiping anyone else's session."*

---

## Scene 5 (`2:35 – 3:00`) — Verification Gates & Close

- **On Screen:**
  1. Show terminal output of `npm run check` (`35 passed`, `266 tests passed`) and `npx tsx scripts/smoke.ts` (`All 7 smoke gates passed`).
  2. Return to `/dashboard` in Dark Mode for the closing frame.
- **Narration:**
  > *"Every claim in ChurnRescue AI is backed by 266 automated tests, mutation proofs for concurrency and state transitions, a zero-PII dashboard contract, and a 7-gate Cloud Run smoke suite. Thank you for watching!"*

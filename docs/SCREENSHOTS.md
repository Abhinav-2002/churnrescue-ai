# ChurnRescue AI — Screenshot Capture Guide (`docs/SCREENSHOTS.md`)

Use this guide to capture the 8 submission screenshots at **`1440×900`** (or `1920×1080` at `100%` zoom) with zero personal bookmarks, zero DevTools panels, and zero exposed secrets.

---

## Recommended Capture Set (8 Screenshots)

| # | Filename | Route / View | What Must Be Visible |
|---|---|---|---|
| **S1** | `01-dashboard-overview-light.png` | `/dashboard` (Light Mode, `Live`) | Header with `"Sandbox demo, no real money"` badge, expanded **"Try it in 3 minutes"** bar (4 guided paths), and the 5 KPI cards (`$150.00` Recovered Revenue, `1` Customer Recovered, `Needs a Human`). |
| **S2** | `02-dashboard-sample-history-dark.png` | `/dashboard` (Dark Mode, `Live + sample`) | Toggle switched to **Live + sample**, showing the `"Includes sample data"` badge, live-vs-sample breakdown banner, 14-day **Failed vs Recovered by Day** chart, **Intervention Mix** donut, and **Recovery Funnel**. |
| **S3** | `03-guardrails-and-human-queue.png` | `/dashboard#guardrails` | **Autonomous Guardrail Audit** panel (`Concession Ladder`, `Forced Retry`, `Keyword Escalation`, `Template Used`, `0 outside policy`, `"Code ladder assigned 20% discount (step 0)"`) and **Needs a Human** queue showing **Diana Prince** (`Chargeback`, `High`, `$50.00`). |
| **S4** | `04-customer-decision-drawer.png` | `/dashboard` (Drawer Open) | Slide-over **Customer Decision Timeline Drawer** open for **Alice Smith** or **Diana Prince**, showing chronological guardrail audit cards and the **Reset Customer Only** button. |
| **S5** | `05-chat-ladder-floor-alice.png` | `/admin` or `/dashboard` Chat Widget (`c_1` Alice) | Multi-turn concession ladder showing `$20.00` (step 0) $\to$ `$16.25` (step 1) $\to$ `$12.50` (`"best I can offer"` + pause option at step 2 floor) without echoing `"$10"`. |
| **S6** | `06-paypal-checkout-hannah.png` | Chat Widget (`c_8` Hannah) | High-usage (`85%`) full-price `$150.00` retry offer with the live **PayPal Checkout v6** button rendered (or **`Account Recovered — Captured: $150.00`** confirmation). |
| **S7** | `07-pause-confirmation-charlie.png` | Chat Widget (`c_3` Charlie) | Two-step pause flow (`E1`) showing `"Please click Confirm Pause below to proceed. Your subscription has not been paused yet."` alongside the **Confirm Pause** and **Cancel** buttons. |
| **S8** | `08-terminal-verification-gates.png` | Terminal (PowerShell) | Clean output of `npm run check` (`35 passed`, `266 passed`) and `npx tsx scripts/smoke.ts` (`[SMOKE SUCCESS] All 7 smoke gates passed`). |

---

## Pre-Capture Privacy & Quality Checklist

- [ ] Browser bookmarks bar is hidden (`Ctrl+Shift+B`).
- [ ] No `.env` file, PayPal secret, or GCP service account key is visible in any editor or terminal window.
- [ ] `/dashboard` DOM contains zero customer email addresses and zero PayPal order IDs.
- [ ] Both Light Mode (`S1`) and Dark Mode (`S2`) are represented.

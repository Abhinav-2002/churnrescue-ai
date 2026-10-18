# Post-Deploy Verification Checklist (`docs/POST_DEPLOY_CHECKLIST.md`)

Use this checklist immediately after starting the production server or deploying a new revision to **Google Cloud Run** (`churnrescue-ai`).

---

## 1. Automated Smoke Suite (`scripts/smoke.ts`)

Run [`scripts/smoke.ts`](../scripts/smoke.ts) against the target origin:

```powershell
# Local verification
$env:SMOKE_BASE_URL = "http://localhost:3000"
npx tsx scripts/smoke.ts

# Cloud Run verification
$env:SMOKE_BASE_URL = "https://churnrescue-ai-<hash>-uc.a.run.app"
npx tsx scripts/smoke.ts
```

### Expected 7-Gate Output:
- `[PASS] 1. GET /api/health -> 200 (status=ok, uptime_s=...)`
- `[PASS] 2. GET /api/ready  -> 200 (db=ok, config=ok)`
- `[PASS] 3. GET /api/debug  -> 404 (debug surface disabled)`
- `[PASS] 4. GET /api/config -> 200 (environment=sandbox, clientId present)`
- `[PASS] 5. GET /api/dashboard/metrics?days=14 -> 200 (outside_policy=0, inconsistencies=0, nosniff+CSP verified)`
- `[PASS] 6. Isolated E2E flow on c_5 -> simulate-failure -> $20.00 offer -> confirm_pause -> paused`
- `[PASS] 7. Restored c_5 via POST /api/demo/reset-customer`

---

## 2. Hosted Demo & Multi-Visitor Safety Checks

1. **Global Reset Blocked (`HOSTED_DEMO=1`):**
   ```powershell
   Invoke-WebRequest -Uri "$env:SMOKE_BASE_URL/api/reset" -Method POST -SkipHttpErrorCheck
   ```
   - Must return HTTP `403` with `{"error": "hosted_reset_disabled"}`.
2. **Per-Customer Reset Enabled (`DEMO_MODE=1`):**
   - Open `/dashboard`, expand **"Try it in 3 minutes"**, click **Reset** on Path 1 (`c_1`), and confirm other customers (`c_4` Diana, `c_8` Hannah) are unaffected.
3. **Sample History Toggle (`is_sample`):**
   - Click **Load sample history** on `/dashboard`, switch between **Live** and **Live + sample**, and verify the **"Includes sample data"** badge and live-vs-sample breakdown banner appear when **Live + sample** is active.

---

## 3. PayPal Sandbox Checkout & Capture Verification

1. Trigger Path 2 (`Hannah` `c_8`, `$150.00` high-usage retry) or Path 1 (`Alice` `c_1`, `$20.00` / `$16.25` / `$12.50` discount).
2. Confirm the PayPal button renders inside the chat widget (loaded with the runtime `paypalClientId` from `/api/config`).
3. Verify pre-captured state in PayPal Sandbox (`Order 3LG77311TG3677635`, `Capture 81485234NB008850W`, `150.00 USD`, `COMPLETED`) matches the database `recoveries` row (`15000` cents) and dashboard KPI (`$150.00` Recovered Revenue).

---

## 4. Cloud Run Logs & GCP Billing Check

1. **Inspect Cloud Run Structured Logs (No Secrets / No PII):**
   ```powershell
   gcloud run services logs read churnrescue-ai --region=us-central1 --limit=30
   ```
   - Confirm `llm_startup_config` logs `llm_model: "gemini-3.5-flash-lite"` and `google_cloud_location: "global"`.
   - Confirm zero secrets, zero `Bearer` tokens, zero customer emails, and zero raw prompts appear in log entries.
2. **Verify GCP Billing Account Status:**
   ```powershell
   gcloud billing projects describe project-03a4bace-4744-4fab-bc9 --format="json(billingAccountName,billingEnabled)"
   ```
   - Confirm `billingEnabled: true` (`billingAccounts/01EFBB-0D5C12-F1257E`).

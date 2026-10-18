# Deploying ChurnRescue AI to Google Cloud Run (`docs/DEPLOY_CLOUD_RUN.md`)

This guide provides the exact, reproducible commands to deploy **ChurnRescue AI** to **Google Cloud Run** using Google Cloud Build, Secret Manager, Vertex AI (`gemini-3.5-flash-lite`), and PayPal Sandbox.

---

## 1. Prerequisites & Project Variables

Set your shell variables in PowerShell (or Bash):

```powershell
$PROJECT_ID = "project-03a4bace-4744-4fab-bc9"
$REGION     = "us-central1"
$SERVICE    = "churnrescue-ai"
gcloud config set project $PROJECT_ID
```

---

## 2. Enable Required Google Cloud APIs

```powershell
gcloud services enable `
  run.googleapis.com `
  cloudbuild.googleapis.com `
  artifactregistry.googleapis.com `
  secretmanager.googleapis.com `
  aiplatform.googleapis.com `
  --project=$PROJECT_ID
```

---

## 3. Configure Least-Privilege Service Account & IAM

Verify or grant the dedicated runtime service account (`churnrescue-ai@project-03a4bace-4744-4fab-bc9.iam.gserviceaccount.com`) access to Vertex AI (`roles/aiplatform.user`) and secret-scoped Secret Manager access (`roles/secretmanager.secretAccessor` on `PAYPAL_CLIENT_SECRET`):

```powershell
$SA_EMAIL = "churnrescue-ai@$PROJECT_ID.iam.gserviceaccount.com"

gcloud iam service-accounts create churnrescue-ai `
  --display-name="ChurnRescue AI Runtime SA" `
  --project=$PROJECT_ID 2>$null

gcloud projects add-iam-policy-binding $PROJECT_ID `
  --member="serviceAccount:$SA_EMAIL" `
  --role="roles/aiplatform.user"

gcloud secrets add-iam-policy-binding PAYPAL_CLIENT_SECRET `
  --member="serviceAccount:$SA_EMAIL" `
  --role="roles/secretmanager.secretAccessor" `
  --project=$PROJECT_ID
```

---

## 4. Store `PAYPAL_CLIENT_SECRET` in Secret Manager

Never pass `PAYPAL_CLIENT_SECRET` in plain-text `--set-env-vars`. Store it in Google Cloud Secret Manager without echoing its value to the terminal:

```powershell
# Reads PAYPAL_CLIENT_SECRET from local .env and pipes it directly to Secret Manager
$secretVal = (Get-Content .env | Where-Object { $_ -match '^PAYPAL_CLIENT_SECRET=' }) -replace '^PAYPAL_CLIENT_SECRET=', ''
$secretVal = $secretVal.Trim('"', "'", " ")

gcloud secrets create PAYPAL_CLIENT_SECRET --replication-policy="automatic" --project=$PROJECT_ID 2>$null
$secretVal | gcloud secrets versions add PAYPAL_CLIENT_SECRET --data-file=- --project=$PROJECT_ID
Remove-Variable secretVal
```

---

## 5. Deploy to Cloud Run from Source (`Dockerfile`)

Because [`Dockerfile`](../Dockerfile) uses Next.js `output: "standalone"` and [`GET /api/config`](../src/app/api/config/route.ts) serves the public PayPal Client ID at runtime, no build-time `NEXT_PUBLIC_PAYPAL_CLIENT_ID` flag is required during `gcloud run deploy`:

```powershell
$PAYPAL_CLIENT_ID = ((Get-Content .env | Where-Object { $_ -match '^PAYPAL_CLIENT_ID=' }) -replace '^PAYPAL_CLIENT_ID=', '').Trim('"', "'", " ")

gcloud run deploy $SERVICE `
  --source . `
  --region=$REGION `
  --platform=managed `
  --service-account=$SA_EMAIL `
  --allow-unauthenticated `
  --max-instances=1 `
  --min-instances=0 `
  --concurrency=20 `
  --memory=1Gi `
  --cpu=1 `
  --timeout=60 `
  --set-env-vars="NODE_ENV=production,GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GOOGLE_CLOUD_LOCATION=global,LLM_MODEL=gemini-3.5-flash-lite,PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com,PAYPAL_CLIENT_ID=$PAYPAL_CLIENT_ID,DEMO_MODE=1,HOSTED_DEMO=1,SQLITE_PATH=/tmp/data.db" `
  --set-secrets="PAYPAL_CLIENT_SECRET=PAYPAL_CLIENT_SECRET:latest" `
  --project=$PROJECT_ID
```

> **Why `--max-instances=1` and `SQLITE_PATH=/tmp/data.db`?**
> ChurnRescue AI uses an embedded SQLite database (`better-sqlite3`). Pinning `--max-instances=1` ensures all concurrent judge sessions hit the same active instance and SQLite WAL state while `HOSTED_DEMO=1` blocks global sandbox resets (`POST /api/reset` $\to$ `403`).

---

## 6. Set `APP_BASE_URL` to the Deployed Cloud Run URL

After deployment completes, retrieve the service URL and set `APP_BASE_URL` so PayPal `return_url` and `cancel_url` point to the live Cloud Run origin:

```powershell
$SERVICE_URL = gcloud run services describe $SERVICE --region=$REGION --format="value(status.url)" --project=$PROJECT_ID
Write-Host "Deployed URL: $SERVICE_URL"

gcloud run services update $SERVICE `
  --region=$REGION `
  --update-env-vars="APP_BASE_URL=$SERVICE_URL" `
  --project=$PROJECT_ID
```

---

## 7. Run Post-Deploy Verification (`scripts/smoke.ts`)

```powershell
$env:SMOKE_BASE_URL = $SERVICE_URL
npx tsx scripts/smoke.ts
```

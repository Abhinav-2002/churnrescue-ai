# Deployment Guide (Render)

This project can be easily deployed to [Render](https://render.com) using the provided `render.yaml` blueprint.

## Click-by-Click Instructions

1. Push your code to a GitHub, GitLab, or Bitbucket repository.
2. Log in to your [Render Dashboard](https://dashboard.render.com/).
3. Click the **New +** button in the top right corner.
4. Select **Blueprint** from the dropdown menu.
5. Connect your GitHub/GitLab account if you haven't already.
6. Select the repository containing this project.
7. Render will automatically detect the `render.yaml` file in the root of the repository.
8. Review the proposed service (it should show a Web Service named `churnrescue-ai`).
9. Click **Apply**.
10. Render will begin provisioning the service, but the build will likely fail initially because environment variables need to be set.
11. Go to the newly created Web Service in the Render Dashboard.
12. Click on **Environment** in the left sidebar.
13. Click **Add Environment Variable** and add the following required secrets (values from `.env`):
    * `PAYPAL_CLIENT_ID`
    * `PAYPAL_CLIENT_SECRET`
    * `NEXT_PUBLIC_PAYPAL_CLIENT_ID`
    * `GOOGLE_CLOUD_PROJECT`
    * `LLM_MODEL`
    * `GOOGLE_CREDENTIALS_JSON` (Paste the entire contents of your Google Cloud Service Account JSON file as a single line/string here)
    * *(Note: `PAYPAL_BASE_URL`, `GOOGLE_CLOUD_LOCATION`, `DEMO_MODE`, and `DAILY_LLM_CALL_LIMIT` are already set by the blueprint).*
14. Click **Save Changes**.
15. Render will automatically trigger a new deployment with the secrets.
16. Watch the **Logs** tab. The app will install dependencies, build, and start. The health check (`/api/health`) will automatically run and seed the SQLite database on cold start.
17. Once deployed, visit your Render URL!

## Debugging

To debug headers on Render, add a `DEBUG_HEADERS=1` environment variable and visit `/api/debug`. Disable this after testing.

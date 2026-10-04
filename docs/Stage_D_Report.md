# Stage D Verification Report

## 1. Render Deployment Details
- **Build command**: `npm install && npm run build`
- **Start command**: `npm start`
- **Health check path**: `/api/health`
- **Ephemeral disk**: "Render Web Services have an ephemeral filesystem. If your service creates or downloads files during runtime, they are deleted when the service restarts or the web service is redeployed" (Source: https://docs.render.com/disks)
- **Idle spin-down behaviour**: "Render spins down a Free web service that goes 15 minutes without receiving inbound traffic." (Source: https://docs.render.com/free)

**Status:** NOT TESTED. The actual deployment on Render's infrastructure has not been tested in a live environment.

## 2. Vertex AI Authentication Without Login
**Mechanism**:
- "If you want to pass credentials directly, you can pass them to the authOptions in the constructor." (Source: https://js.langchain.com/docs/integrations/chat/google_vertex_ai)

**Status:** NOT TESTED. The application implements parsing and passing the `authOptions`, but it hasn't been tested with a real Vertex service account credentials file.

**src/lib/agent/graph.ts lines reading GOOGLE_CREDENTIALS_JSON:**
```typescript
  const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;
  let credentials: any = undefined;
  if (credentialsJson) {
    try {
      // Replace literal \n with real newlines in private_key (common pitfall with env vars)
      const parsed = JSON.parse(credentialsJson);
      if (parsed.private_key) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      credentials = parsed;
    } catch (e) {
      console.error('[graph] GOOGLE_CREDENTIALS_JSON is not valid JSON — falling back to ADC');
    }
  }
  return new ChatVertexAI({
    ...(credentials ? { authOptions: { credentials } } : {}),
    model: modelId,
    location,
```
*(A try/catch block successfully prevents any secret values from leaking into logs during a startup error).*

import { ChatVertexAI } from '@langchain/google-vertexai';

export function getLlm(modelId: string) {
  const location = process.env.GOOGLE_CLOUD_LOCATION || 'global';
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
      console.error('[graph] GOOGLE_CREDENTIALS_JSON is not valid JSON – falling back to ADC');
    }
  }
  return new ChatVertexAI({
    ...(credentials ? { authOptions: { credentials } } : {}),
    model: modelId,
    location,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    ...(location === 'global' ? { endpoint: 'aiplatform.googleapis.com' } : {}),
    maxRetries: 0
  } as any);
}

import { ChatVertexAI } from '@langchain/google-vertexai';

export const DEFAULT_LLM_TIMEOUT_MS = 15000;

declare global {
  var _llmStartupLogged: boolean | undefined;
}

export function logLlmStartupOnce(modelId?: string): { model: string; location: string } {
  const model = modelId || process.env.LLM_MODEL || 'gemini-3.5-flash-lite';
  const location = process.env.GOOGLE_CLOUD_LOCATION || 'global';
  if (!globalThis._llmStartupLogged) {
    globalThis._llmStartupLogged = true;
    if (process.env.NODE_ENV !== 'test') {
      console.log(
        JSON.stringify({
          event: 'llm_startup_config',
          llm_model: model,
          google_cloud_location: location,
        })
      );
    }
  }
  return { model, location };
}

export async function invokeWithTimeoutAndRetry<T>(
  fn: () => Promise<T>,
  timeoutMs: number = Number(process.env.LLM_TIMEOUT_MS) || DEFAULT_LLM_TIMEOUT_MS,
  retries: number = 1
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await Promise.race<T>([
        fn(),
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`LLM call timed out after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
      return result;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export function getLlm(modelId: string) {
  const { model, location } = logLlmStartupOnce(modelId);
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
    model,
    location,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    ...(location === 'global' ? { endpoint: 'aiplatform.googleapis.com' } : {}),
    maxRetries: 1,
  } as any);
}

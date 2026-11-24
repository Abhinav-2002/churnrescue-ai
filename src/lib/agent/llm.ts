import { ChatVertexAI } from '@langchain/google-vertexai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

export const DEFAULT_LLM_TIMEOUT_MS = 15000;
export const DEFAULT_GEMINI_API_MODEL = 'gemini-2.5-flash-lite';
export const DEFAULT_VERTEX_MODEL = 'gemini-3.5-flash-lite';

declare global {
  var _llmStartupLogged: boolean | undefined;
}

export function resolveLlmProvider(env: NodeJS.ProcessEnv = process.env): 'google_ai_studio' | 'vertex_ai' {
  const apiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
  return apiKey ? 'google_ai_studio' : 'vertex_ai';
}

export function logLlmStartupOnce(modelId?: string): { model: string; location: string; provider: 'google_ai_studio' | 'vertex_ai' } {
  const provider = resolveLlmProvider();
  const defaultModel = provider === 'google_ai_studio' ? DEFAULT_GEMINI_API_MODEL : DEFAULT_VERTEX_MODEL;
  const model = modelId || process.env.LLM_MODEL || defaultModel;
  const location = process.env.GOOGLE_CLOUD_LOCATION || 'global';
  if (!globalThis._llmStartupLogged) {
    globalThis._llmStartupLogged = true;
    if (process.env.NODE_ENV !== 'test') {
      console.log(
        JSON.stringify({
          event: 'llm_startup_config',
          llm_provider: provider,
          llm_model: model,
          google_cloud_location: location,
        })
      );
    }
  }
  return { model, location, provider };
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

export function getLlm(modelId?: string) {
  const { model, location, provider } = logLlmStartupOnce(modelId);

  if (provider === 'google_ai_studio') {
    const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    return new ChatGoogleGenerativeAI({
      apiKey,
      model,
      maxRetries: 1,
    });
  }

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

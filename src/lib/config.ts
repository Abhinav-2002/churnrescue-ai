import { z } from 'zod';

export const SANDBOX_PAYPAL_URL = 'https://api-m.sandbox.paypal.com';

const envSchema = z.object({
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  GOOGLE_CLOUD_LOCATION: z.string().min(1).default('global'),
  LLM_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_CLIENT_SECRET: z.string().min(1),
  PAYPAL_BASE_URL: z.literal(SANDBOX_PAYPAL_URL),
  DEMO_MODE: z.enum(['0', '1']).optional().default('0'),
  SQLITE_PATH: z.string().min(1).optional().default('data.db'),
  APP_BASE_URL: z.string().url().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

export interface ConfigValidationResult {
  valid: boolean;
  missingOrInvalidKeys: string[];
  config?: AppConfig;
}

/**
 * Validates required startup environment variables using Zod.
 * On failure, reports ONLY variable names — never variable values or secrets.
 */
export function validateConfig(env: NodeJS.ProcessEnv = process.env): ConfigValidationResult {
  const result = envSchema.safeParse({
    GOOGLE_CLOUD_PROJECT: env.GOOGLE_CLOUD_PROJECT,
    GOOGLE_CLOUD_LOCATION: env.GOOGLE_CLOUD_LOCATION || 'global',
    LLM_MODEL: env.LLM_MODEL || 'gemini-3.5-flash-lite',
    PAYPAL_CLIENT_ID: env.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: env.PAYPAL_CLIENT_SECRET,
    PAYPAL_BASE_URL: env.PAYPAL_BASE_URL,
    DEMO_MODE: env.DEMO_MODE || '0',
    SQLITE_PATH: env.SQLITE_PATH || 'data.db',
    APP_BASE_URL: env.APP_BASE_URL || undefined,
  });

  if (!result.success) {
    const keys = Array.from(
      new Set(
        result.error.issues
          .map((issue) => String(issue.path[0] || 'UNKNOWN'))
          .filter(Boolean)
      )
    );
    return {
      valid: false,
      missingOrInvalidKeys: keys,
    };
  }

  return {
    valid: true,
    missingOrInvalidKeys: [],
    config: result.data,
  };
}

/**
 * Validates startup config and throws an Error listing ONLY variable names on failure.
 */
export function assertStartupConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const res = validateConfig(env);
  if (!res.valid || !res.config) {
    throw new Error(
      `Startup configuration validation failed for variable(s): ${res.missingOrInvalidKeys.join(', ')}`
    );
  }
  return res.config;
}

/**
 * Resolves the application base URL from APP_BASE_URL or an incoming request origin.
 * Never returns hardcoded localhost or example.com placeholders in production.
 */
export function resolveAppBaseUrl(requestOrigin?: string | null): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  if (requestOrigin && /^https?:\/\//i.test(requestOrigin)) {
    return requestOrigin.replace(/\/+$/, '');
  }
  const cloudRunServiceUrl = process.env.K_SERVICE
    ? `https://${process.env.K_SERVICE}.run.app`
    : 'https://churnrescue-ai.run.app';
  return cloudRunServiceUrl;
}

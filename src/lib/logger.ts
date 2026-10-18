import crypto from 'crypto';

export interface StructuredLogInput {
  requestId?: string;
  route: string;
  status: number;
  latency_ms: number;
  outcome_code: string;
  llm_latency_ms?: number | null;
  meta?: Record<string, unknown>;
}

export interface StructuredLogEntry {
  timestamp: string;
  requestId: string;
  route: string;
  status: number;
  latency_ms: number;
  outcome_code: string;
  llm_latency_ms: number | null;
  meta?: Record<string, unknown>;
}

const FORBIDDEN_META_KEYS = new Set([
  'prompt',
  'prompts',
  'text',
  'message',
  'messages',
  'customer_text',
  'email',
  'customer_email',
  'paypal_body',
  'response_body',
  'raw_body',
  'access_token',
  'token',
  'authorization',
  'client_secret',
  'paypal_client_secret',
  'private_key',
  'google_credentials_json',
  'password',
  'secret',
  'reasoning',
]);

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const BEARER_REGEX = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const BASIC_REGEX = /Basic\s+[A-Za-z0-9+/=]{8,}/gi;
const SECRET_TOKEN_REGEX = /\b(A21AA[A-Za-z0-9_-]{10,}|E[A-Za-z0-9_-]{25,}|ya29\.[A-Za-z0-9_-]+|AIza[0-9A-Za-z_-]{20,})\b/g;

export function redactString(input: string): string {
  return input
    .replace(EMAIL_REGEX, '[REDACTED_EMAIL]')
    .replace(BEARER_REGEX, 'Bearer [REDACTED_TOKEN]')
    .replace(BASIC_REGEX, 'Basic [REDACTED_AUTH]')
    .replace(SECRET_TOKEN_REGEX, '[REDACTED_SECRET]');
}

export function sanitizeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    const lowerKey = k.toLowerCase();
    if (
      FORBIDDEN_META_KEYS.has(lowerKey) ||
      lowerKey.includes('secret') ||
      lowerKey.includes('token') ||
      lowerKey.includes('password') ||
      lowerKey.includes('email') ||
      lowerKey.includes('prompt')
    ) {
      cleaned[k] = '[REDACTED]';
      continue;
    }
    if (typeof v === 'string') {
      cleaned[k] = redactString(v);
    } else if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
      cleaned[k] = v;
    } else if (Array.isArray(v)) {
      cleaned[k] = v.map((item) => (typeof item === 'string' ? redactString(item) : '[OBJECT]'));
    } else if (typeof v === 'object') {
      cleaned[k] = sanitizeMeta(v as Record<string, unknown>);
    }
  }
  return cleaned;
}

export function buildStructuredLog(input: StructuredLogInput): StructuredLogEntry {
  const entry: StructuredLogEntry = {
    timestamp: new Date().toISOString(),
    requestId: input.requestId || crypto.randomUUID(),
    route: redactString(input.route),
    status: input.status,
    latency_ms: Math.max(0, Math.round(input.latency_ms)),
    outcome_code: redactString(input.outcome_code),
    llm_latency_ms: input.llm_latency_ms != null ? Math.max(0, Math.round(input.llm_latency_ms)) : null,
  };

  if (input.meta) {
    entry.meta = sanitizeMeta(input.meta);
  }

  return entry;
}

export function logRequest(input: StructuredLogInput): string {
  const entry = buildStructuredLog(input);
  const serialized = JSON.stringify(entry);
  if (process.env.NODE_ENV !== 'test') {
    console.log(serialized);
  }
  return serialized;
}

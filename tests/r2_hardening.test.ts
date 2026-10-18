import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { validateConfig, assertStartupConfig, resolveAppBaseUrl, SANDBOX_PAYPAL_URL } from '../src/lib/config';
import { buildStructuredLog, logRequest, redactString } from '../src/lib/logger';
import { GET as healthGET } from '../src/app/api/health/route';
import { GET as readyGET } from '../src/app/api/ready/route';
import { GET as debugGET } from '../src/app/api/debug/route';
import { closeDb, getDb, resetDb } from '../src/lib/db';
import { invokeWithTimeoutAndRetry } from '../src/lib/agent/llm';
import nextConfig, { SECURITY_HEADERS, PAYPAL_CSP_REPORT_ONLY } from '../next.config';

describe('Stage R2 (r2-hardening): Config Validation, Redacting Logger, Health/Ready, Security Headers, LLM Retry', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...origEnv,
      NODE_ENV: 'test',
      GOOGLE_CLOUD_PROJECT: 'project-test-123',
      GOOGLE_CLOUD_LOCATION: 'global',
      LLM_MODEL: 'gemini-3.5-flash-lite',
      PAYPAL_CLIENT_ID: 'test-client-id',
      PAYPAL_CLIENT_SECRET: 'SUPER_SECRET_VALUE_DO_NOT_LEAK_999',
      PAYPAL_BASE_URL: SANDBOX_PAYPAL_URL,
      DEMO_MODE: '1',
    };
    resetDb();
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('1. Startup config validation passes on valid sandbox env and lists ONLY variable names (never values) on failure', () => {
    const validRes = validateConfig(process.env);
    expect(validRes.valid).toBe(true);
    expect(validRes.missingOrInvalidKeys).toEqual([]);

    const badEnv: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      GOOGLE_CLOUD_PROJECT: '',
      PAYPAL_CLIENT_ID: 'client_123',
      PAYPAL_CLIENT_SECRET: 'ULTRA_SENSITIVE_SECRET_XYZ_12345',
      PAYPAL_BASE_URL: 'https://api-m.paypal.com', // non-sandbox!
    };

    const invalidRes = validateConfig(badEnv);
    expect(invalidRes.valid).toBe(false);
    expect(invalidRes.missingOrInvalidKeys).toContain('GOOGLE_CLOUD_PROJECT');
    expect(invalidRes.missingOrInvalidKeys).toContain('PAYPAL_BASE_URL');

    expect(() => assertStartupConfig(badEnv)).toThrow(/GOOGLE_CLOUD_PROJECT/);
    try {
      assertStartupConfig(badEnv);
    } catch (err: any) {
      expect(err.message).not.toContain('ULTRA_SENSITIVE_SECRET_XYZ_12345');
      expect(err.message).not.toContain('https://api-m.paypal.com');
    }
  });

  it('2. resolveAppBaseUrl uses APP_BASE_URL or request origin and never falls back to localhost or example.com', () => {
    process.env.APP_BASE_URL = 'https://churnrescue-demo.a.run.app/';
    expect(resolveAppBaseUrl()).toBe('https://churnrescue-demo.a.run.app');

    delete process.env.APP_BASE_URL;
    expect(resolveAppBaseUrl('https://custom-origin.run.app/')).toBe('https://custom-origin.run.app');

    const fallback = resolveAppBaseUrl();
    expect(fallback).not.toContain('localhost');
    expect(fallback).not.toContain('example.com');
  });

  it('3. Structured logger outputs required fields and redacts secrets, tokens, emails, prompts, and customer text', () => {
    const secretToken = 'A21AAKn9SecretPayPalAccessTokenValue123456789';
    const secretClient = 'ECl9SecretPayPalClientSecretKey987654321000000';
    const customerEmail = 'alice.private@example.com';
    const customerPrompt = 'Can you lower my bill to $10 please?';

    const serialized = logRequest({
      requestId: 'req_123',
      route: `/api/agent/message?email=${customerEmail}`,
      status: 200,
      latency_ms: 142.7,
      outcome_code: `ok_with_Bearer ${secretToken}`,
      llm_latency_ms: 98.2,
      meta: {
        prompt: customerPrompt,
        customer_text: customerPrompt,
        email: customerEmail,
        paypal_client_secret: secretClient,
        authorization: `Bearer ${secretToken}`,
        paypal_body: { id: 'ORD_123', payer: customerEmail },
        note: `Contact ${customerEmail} with token ${secretToken} and key ${secretClient}`,
        ladderStep: 1,
      },
    });

    expect(serialized).not.toContain(secretToken);
    expect(serialized).not.toContain(secretClient);
    expect(serialized).not.toContain(customerEmail);
    expect(serialized).not.toContain(customerPrompt);

    const parsed = JSON.parse(serialized);
    expect(parsed.requestId).toBe('req_123');
    expect(parsed.status).toBe(200);
    expect(parsed.latency_ms).toBe(143);
    expect(parsed.llm_latency_ms).toBe(98);
    expect(parsed.meta.prompt).toBe('[REDACTED]');
    expect(parsed.meta.customer_text).toBe('[REDACTED]');
    expect(parsed.meta.email).toBe('[REDACTED]');
    expect(parsed.meta.paypal_client_secret).toBe('[REDACTED]');
    expect(parsed.meta.authorization).toBe('[REDACTED]');
    expect(parsed.meta.paypal_body).toBe('[REDACTED]');
    expect(parsed.meta.ladderStep).toBe(1);
    expect( redactString(`Basic dXNlcjpwYXNzd29yZDEyMw==`) ).toBe('Basic [REDACTED_AUTH]');
  });

  it('4. /api/health, /api/ready, and closeDb work as expected', async () => {
    const healthRes = await healthGET();
    expect(healthRes.status).toBe(200);
    const healthJson = await healthRes.json();
    expect(healthJson.status).toBe('ok');
    expect(typeof healthJson.uptime_s).toBe('number');

    const readyRes = await readyGET();
    expect(readyRes.status).toBe(200);
    const readyJson = await readyRes.json();
    expect(readyJson.status).toBe('ready');
    expect(readyJson.db).toBe('ok');
    expect(readyJson.config).toBe('ok');

    // Break config -> /api/ready returns 503 with variable names only
    process.env.PAYPAL_BASE_URL = 'https://invalid.paypal.com';
    const notReadyRes = await readyGET();
    expect(notReadyRes.status).toBe(503);
    const notReadyJson = await notReadyRes.json();
    expect(notReadyJson.status).toBe('not_ready');
    expect(notReadyJson.missingOrInvalidKeys).toContain('PAYPAL_BASE_URL');

    // Graceful closeDb() and re-initialization
    closeDb();
    const dbAgain = getDb();
    const row = dbAgain.prepare('SELECT 1 as ok').get() as { ok: number };
    expect(row.ok).toBe(1);
  });

  it('5. Security headers and PayPal v6 Content-Security-Policy-Report-Only are configured in next.config.ts', async () => {
    expect(nextConfig.output).toBe('standalone');
    expect(PAYPAL_CSP_REPORT_ONLY).toContain('https://*.paypal.com');
    expect(PAYPAL_CSP_REPORT_ONLY).toContain('https://*.paypalobjects.com');
    const keys = SECURITY_HEADERS.map((h) => h.key);
    expect(keys).toContain('X-Content-Type-Options');
    expect(keys).toContain('Referrer-Policy');
    expect(keys).toContain('X-Frame-Options');
    expect(keys).toContain('Permissions-Policy');
    expect(keys).toContain('Content-Security-Policy-Report-Only');
  });

  it('6. invokeWithTimeoutAndRetry retries once on transient error or timeout', async () => {
    let attempts = 0;
    const result = await invokeWithTimeoutAndRetry(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error('Transient Vertex AI 503');
      }
      return 'recovered_on_retry';
    }, 1000, 1);

    expect(result).toBe('recovered_on_retry');
    expect(attempts).toBe(2);
  });

  it('7. /api/debug returns 404 by default and strips sensitive headers when DEBUG_HEADERS=1', async () => {
    delete process.env.DEBUG_HEADERS;
    const reqOff = new NextRequest('http://localhost:3000/api/debug', {
      headers: { Authorization: 'Bearer secret_123', 'x-forwarded-for': '203.0.113.5' },
    });
    const resOff = await debugGET(reqOff);
    expect(resOff.status).toBe(404);

    process.env.DEBUG_HEADERS = '1';
    const reqOn = new NextRequest('http://localhost:3000/api/debug', {
      headers: {
        Authorization: 'Bearer secret_123',
        Cookie: 'session=secret',
        'x-forwarded-for': '203.0.113.5',
      },
    });
    const resOn = await debugGET(reqOn);
    expect(resOn.status).toBe(200);
    const bodyOn = await resOn.json();
    expect(bodyOn.allHeaderNames).not.toContain('authorization');
    expect(bodyOn.allHeaderNames).not.toContain('cookie');
    expect(bodyOn.ipHeaders['x-forwarded-for']).toBe('203.0.113.5');
  });
});

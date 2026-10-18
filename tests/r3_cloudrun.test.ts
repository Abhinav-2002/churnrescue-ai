import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { GET as configGET } from '../src/app/api/config/route';

describe('Stage R3 (r3-cloudrun): Runtime PayPal Client ID & Cloud Run Containerization', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('1. GET /api/config serves paypalClientId at runtime without NEXT_PUBLIC_PAYPAL_CLIENT_ID and never exposes PAYPAL_CLIENT_SECRET', async () => {
    delete process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
    process.env.PAYPAL_CLIENT_ID = 'RUNTIME_SANDBOX_CLIENT_ID_123';
    process.env.PAYPAL_CLIENT_SECRET = 'TOP_SECRET_DO_NOT_EXPOSE_999';

    const res = await configGET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const rawText = await res.text();
    expect(rawText).not.toContain('TOP_SECRET_DO_NOT_EXPOSE_999');

    const json = JSON.parse(rawText);
    expect(json.paypalClientId).toBe('RUNTIME_SANDBOX_CLIENT_ID_123');
    expect(json.environment).toBe('sandbox');
    expect(Object.keys(json)).toEqual(['paypalClientId', 'environment']);
  });

  it('2. Multi-stage Dockerfile and .dockerignore enforce Node 22 Debian, standalone output, non-root user, PORT=8080, and /tmp/data.db', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
    const dockerignore = fs.readFileSync(path.join(repoRoot, '.dockerignore'), 'utf8');

    expect(dockerfile).toContain('FROM node:22-bookworm-slim');
    expect(dockerfile).toContain('USER nextjs');
    expect(dockerfile).toContain('ENV PORT=8080');
    expect(dockerfile).toContain('ENV SQLITE_PATH="/tmp/data.db"');
    expect(dockerfile).toContain('.next/standalone');
    expect(dockerfile).toContain('CMD ["node", "server.js"]');

    expect(dockerignore).toContain('node_modules');
    expect(dockerignore).toContain('.next');
    expect(dockerignore).toContain('.env');
    expect(dockerignore).toContain('data.db');
  });
});

import { NextResponse } from 'next/server';

const requestCounts = new Map<string, { count: number; expiresAt: number }>();
let globalLlmCalls = 0;
let llmCallsDate = new Date().toDateString();

export function getClientIp(req: Request) {
  // https://docs.render.com/web-services
  // Do not trust the leftmost value because it can be spoofed by the client.
  // Render passes true-client-ip natively. We use it, or fallback to the rightmost x-forwarded-for value.
  const trueClientIp = req.headers.get('true-client-ip');
  if (trueClientIp) return trueClientIp;

  const xForwardedFor = req.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    const parts = xForwardedFor.split(',');
    return parts[parts.length - 1].trim(); 
  }
  return '127.0.0.1';
}

export function rateLimit(req: Request, limit: number, windowMs: number) {
  const ip = getClientIp(req);
  const key = `${new URL(req.url).pathname}:${ip}`;
  const now = Date.now();

  const record = requestCounts.get(key) || { count: 0, expiresAt: now + windowMs };
  if (now > record.expiresAt) {
    record.count = 0;
    record.expiresAt = now + windowMs;
  }
  
  record.count++;
  requestCounts.set(key, record);

  if (record.count > limit) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  return null;
}

export function checkLlmBudget(): boolean {
  const today = new Date().toDateString();
  if (today !== llmCallsDate) {
    globalLlmCalls = 0;
    llmCallsDate = today;
  }
  const limit = parseInt(process.env.DAILY_LLM_CALL_LIMIT || '500', 10);
  if (globalLlmCalls >= limit) {
    return false;
  }
  globalLlmCalls++;
  return true;
}

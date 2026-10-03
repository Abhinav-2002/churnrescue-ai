import { NextResponse } from 'next/server';
import { isIP } from 'node:net';

/**
 * Rate limiting and LLM budget for public demo routes.
 *
 * PRIMARY protection: a GLOBAL cap per route (all visitors combined). It does not
 * depend on any client-supplied header, so spoofing headers cannot bypass it.
 *
 * SECONDARY protection: a per-IP cap. I could not find an official Render doc that
 * states which header carries a trustworthy client IP (True-Client-IP, CF-Connecting-IP
 * or a specific X-Forwarded-For position). Until that is verified on a real Render
 * deploy, the per-IP key is best effort:
 *   - We never use the leftmost X-Forwarded-For value (fully client-controlled).
 *   - We use the rightmost X-Forwarded-For entry, i.e. the hop appended closest to us.
 *     If several proxies sit in front, this may be a proxy address, which simply
 *     degrades to a shared bucket. It cannot be used to dodge the global cap.
 *   - If no syntactically valid IP is found, everyone shares one bucket.
 *
 * State is in-process memory. This is fine for a single Render instance; it resets on
 * restart and is not shared across instances.
 */

export const SHARED_IP_BUCKET = 'shared';

export interface LimitSpec {
  name: string;
  globalPerWindow: number;
  perIpPerWindow: number;
  windowMs: number;
}

export const LIMITS = {
  reset: { name: 'reset', globalPerWindow: 20, perIpPerWindow: 5, windowMs: 60_000 },
  simulateFailure: { name: 'simulate-failure', globalPerWindow: 60, perIpPerWindow: 10, windowMs: 60_000 },
  agentStart: { name: 'agent-start', globalPerWindow: 60, perIpPerWindow: 20, windowMs: 60_000 },
  agentMessage: { name: 'agent-message', globalPerWindow: 120, perIpPerWindow: 20, windowMs: 60_000 },
  capture: { name: 'capture', globalPerWindow: 120, perIpPerWindow: 30, windowMs: 60_000 },
} satisfies Record<string, LimitSpec>;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** Returns a usable client IP, or null if none can be determined. Best effort only. */
export function getClientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (!xff) return null;
  const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
  const rightmost = parts[parts.length - 1];
  if (rightmost && isIP(rightmost) !== 0) return rightmost;
  return null;
}

function hit(key: string, limit: number, windowMs: number, now: number): boolean {
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

/**
 * Applies the global cap first, then the per-IP cap.
 * Returns a 429 response if limited, or null if the request may proceed.
 */
export function rateLimit(req: Request, spec: LimitSpec): NextResponse | null {
  const now = Date.now();
  if (!hit(`global:${spec.name}`, spec.globalPerWindow, spec.windowMs, now)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const ip = getClientIp(req) ?? SHARED_IP_BUCKET;
  if (!hit(`ip:${spec.name}:${ip}`, spec.perIpPerWindow, spec.windowMs, now)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Global daily LLM budget: one unit per graph run (not per model call / node).
// ---------------------------------------------------------------------------

export const BUSY_REPLY = "We're busy right now, please try again shortly.";

let llmRunsToday = 0;
let llmDay = new Date().toISOString().slice(0, 10); // UTC date

function dailyLimit(): number {
  const n = Number.parseInt(process.env.DAILY_LLM_CALL_LIMIT ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 500;
}

/** Consumes one unit for a graph run. Returns false (and consumes nothing) if exhausted. */
export function tryConsumeLlmRun(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== llmDay) {
    llmDay = today;
    llmRunsToday = 0;
  }
  if (llmRunsToday >= dailyLimit()) return false;
  llmRunsToday++;
  return true;
}

/** Test helper: clears all rate-limit buckets and the LLM budget counter. */
export function resetRateLimitsForTests(): void {
  buckets.clear();
  llmRunsToday = 0;
  llmDay = new Date().toISOString().slice(0, 10);
}

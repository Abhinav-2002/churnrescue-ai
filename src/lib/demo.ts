/**
 * Single place that reads DEMO_MODE and HOSTED_DEMO.
 * DEMO_MODE=1 enables the demo-only surfaces: /admin, POST /api/reset,
 * POST /api/demo/reset-customer, POST /api/demo/sample, POST /api/simulate-failure.
 * Any other value (or unset) disables them; they then respond 404.
 *
 * HOSTED_DEMO=1 disables global reset (POST /api/reset) unless ALLOW_GLOBAL_RESET=1
 * is also set, so concurrent judges cannot wipe each other's active sessions.
 */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === '1';
}

export function isHostedDemo(): boolean {
  return process.env.HOSTED_DEMO === '1';
}

export function isGlobalResetAllowed(): boolean {
  return !isHostedDemo() || process.env.ALLOW_GLOBAL_RESET === '1';
}


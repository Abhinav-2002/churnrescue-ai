/**
 * Single place that reads DEMO_MODE.
 * DEMO_MODE=1 enables the demo-only surfaces: /admin, POST /api/reset, POST /api/simulate-failure.
 * Any other value (or unset) disables them; they then respond 404.
 */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === '1';
}

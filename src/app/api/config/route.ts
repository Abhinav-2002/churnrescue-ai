import { NextResponse } from 'next/server';

/**
 * Runtime public configuration endpoint (`GET /api/config`).
 * Serves the public PayPal Sandbox Client ID at runtime so container builds
 * do not require `NEXT_PUBLIC_PAYPAL_CLIENT_ID` baked in at build time.
 * Strictly omits PAYPAL_CLIENT_SECRET and all private server credentials.
 */
export async function GET() {
  const paypalClientId =
    process.env.PAYPAL_CLIENT_ID ||
    process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ||
    'test';

  return NextResponse.json(
    {
      paypalClientId,
      environment: 'sandbox',
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}

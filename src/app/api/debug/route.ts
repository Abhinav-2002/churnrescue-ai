import { NextRequest, NextResponse } from 'next/server';

const SENSITIVE_HEADER_NAMES = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization']);

export async function GET(request: NextRequest) {
  if (process.env.DEBUG_HEADERS !== '1') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const headersObj: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (!SENSITIVE_HEADER_NAMES.has(key.toLowerCase())) {
      headersObj[key] = value;
    }
  });

  return NextResponse.json({
    message: 'Debug Headers',
    allHeaderNames: Object.keys(headersObj),
    ipHeaders: {
      'x-forwarded-for': headersObj['x-forwarded-for'] || null,
      'true-client-ip': headersObj['true-client-ip'] || null,
      'cf-connecting-ip': headersObj['cf-connecting-ip'] || null,
      'x-real-ip': headersObj['x-real-ip'] || null,
    }
  });
}


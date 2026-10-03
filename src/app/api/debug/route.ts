import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  if (process.env.DEBUG_HEADERS !== '1') {
    return new NextResponse('Not found', { status: 404 });
  }

  const headersObj: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headersObj[key] = value;
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

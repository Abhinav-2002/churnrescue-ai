import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { validateConfig } from '@/lib/config';

export async function GET() {
  let dbOk = false;
  try {
    const db = getDb();
    const row = db.prepare('SELECT 1 as ok').get() as { ok: number } | undefined;
    dbOk = row?.ok === 1;
  } catch {
    dbOk = false;
  }

  const configResult = validateConfig();

  if (!dbOk || !configResult.valid) {
    return NextResponse.json(
      {
        status: 'not_ready',
        db: dbOk ? 'ok' : 'error',
        config: configResult.valid ? 'ok' : 'invalid',
        missingOrInvalidKeys: configResult.missingOrInvalidKeys,
      },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }

  return NextResponse.json(
    {
      status: 'ready',
      db: 'ok',
      config: 'ok',
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}

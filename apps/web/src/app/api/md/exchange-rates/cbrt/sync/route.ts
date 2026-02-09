import { NextResponse } from 'next/server';
import { apiFetchServer } from '../../../../../../lib/server-api';

export async function POST(req: Request) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString(); // expects date=YYYY-MM-DD

  const data = await apiFetchServer(`/md/exchange-rates/cbrt/sync?${qs}`, { method: 'POST' });
  return NextResponse.json(data);
}
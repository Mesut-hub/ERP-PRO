import { NextResponse } from 'next/server';
import { apiFetchServer } from '../../../../lib/server-api';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();

  const data = await apiFetchServer(`/md/exchange-rates?${qs}`, { method: 'GET' });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  const data = await apiFetchServer(`/md/exchange-rates`, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
  });

  return NextResponse.json(data);
}
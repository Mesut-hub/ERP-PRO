import { NextResponse } from 'next/server';
import { apiFetchServer } from '../../../../../lib/server-api';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();

  const data = await apiFetchServer(`/inv/reports/fifo-allocations?${qs}`, { method: 'GET' });
  return NextResponse.json(data);
}
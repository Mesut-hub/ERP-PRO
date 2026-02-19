import { NextResponse } from 'next/server';
import { apiFetchServer } from '../../../../../lib/server-api';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const data = await apiFetchServer(`/sales/invoices`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return NextResponse.json(data);
}
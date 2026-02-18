import { NextResponse } from 'next/server';
import { apiFetchServer } from '../../../../../../lib/server-api';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const data = await apiFetchServer(`/sales/invoices/${encodeURIComponent(id)}/post`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return NextResponse.json(data);
}
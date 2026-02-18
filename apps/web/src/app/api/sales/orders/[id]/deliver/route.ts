import { NextResponse } from 'next/server';
import { apiFetchServer } from '../../../../../../lib/server-api';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const data = await apiFetchServer(`/sales/orders/${encodeURIComponent(id)}/deliver`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return NextResponse.json(data);
}
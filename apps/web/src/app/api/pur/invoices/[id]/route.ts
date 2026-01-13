import { NextResponse } from 'next/server';
import { apiFetchServer } from '../../../../../lib/server-api';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const data = await apiFetchServer(`/pur/invoices/${encodeURIComponent(id)}`, { method: 'GET' });
  return NextResponse.json(data);
}
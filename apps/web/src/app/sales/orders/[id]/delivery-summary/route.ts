import { NextResponse } from 'next/server';
import { apiFetchServer } from '../../../../../lib/server-api';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const data = await apiFetchServer(`/sales/orders/${encodeURIComponent(id)}/delivery-summary`, { method: 'GET' });
  return NextResponse.json(data);
}
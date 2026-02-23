import { bffJson } from '@/lib/bff';
import { apiFetchServer } from '@/lib/server-api';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return bffJson(() => apiFetchServer(`/inv/moves/${encodeURIComponent(id)}`, { method: 'GET' }));
}
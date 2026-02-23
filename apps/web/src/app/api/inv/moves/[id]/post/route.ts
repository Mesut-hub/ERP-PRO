import { bffJson } from '@/lib/bff';
import { apiFetchServer } from '@/lib/server-api';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  return bffJson(() =>
    apiFetchServer(`/inv/moves/${encodeURIComponent(id)}/post`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
}
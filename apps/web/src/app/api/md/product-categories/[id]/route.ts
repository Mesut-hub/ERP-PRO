import { NextResponse } from 'next/server';

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3001';

async function forward(req: Request, path: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: req.method,
    headers: {
      'content-type': req.headers.get('content-type') ?? 'application/json',
      authorization: req.headers.get('authorization') ?? '',
      cookie: req.headers.get('cookie') ?? '',
    },
    body: req.method === 'GET' ? undefined : await req.text(),
    cache: 'no-store',
  });

  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return forward(req, `/md/product-categories/${encodeURIComponent(id)}`);
}
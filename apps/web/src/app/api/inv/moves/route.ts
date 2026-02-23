import { bffJson } from '@/lib/bff';
import { apiFetchServer } from '@/lib/server-api';

export async function GET() {
  return bffJson(() => apiFetchServer(`/inv/moves`, { method: 'GET' }));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return bffJson(() =>
    apiFetchServer(`/inv/moves`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
}
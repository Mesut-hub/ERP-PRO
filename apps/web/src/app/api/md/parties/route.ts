import { bffJson } from '@/lib/bff';
import { apiFetchServer } from '@/lib/server-api';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  return bffJson(() => apiFetchServer(`/md/parties?${qs}`, { method: 'GET' }));
}
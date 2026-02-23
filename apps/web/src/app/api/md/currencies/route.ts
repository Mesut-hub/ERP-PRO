import { bffJson } from '@/lib/bff';
import { apiFetchServer } from '@/lib/server-api';

export async function GET() {
  return bffJson(() => apiFetchServer(`/md/currencies`, { method: 'GET' }));
}
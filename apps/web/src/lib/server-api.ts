import { getAccessToken } from './server-auth';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

if (!API_BASE) {
  console.warn('NEXT_PUBLIC_API_BASE_URL is not set');
}

export async function apiFetchServer(path: string, init?: RequestInit) {
  const token = await getAccessToken();

  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });

  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const msg = typeof body === 'object' && body?.message ? body.message : `API ${res.status}`;
    throw new Error(msg);
  }

  return body;
}
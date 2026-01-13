import { NextResponse } from 'next/server';
import { setAccessCookie, clearAccessCookie } from '../../../../lib/server-auth';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

export async function POST() {
  const apiRes = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });

  const body = await apiRes.json().catch(() => null);

  if (!apiRes.ok) {
    await clearAccessCookie();
    return NextResponse.json(body ?? { message: 'Refresh failed' }, { status: apiRes.status });
  }

  if (!body?.accessToken) {
    await clearAccessCookie();
    return NextResponse.json({ ok: true, accessToken: null });
  }

  await setAccessCookie(body.accessToken);
  return NextResponse.json({ ok: true });
}
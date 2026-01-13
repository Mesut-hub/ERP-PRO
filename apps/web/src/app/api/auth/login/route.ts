import { NextResponse } from 'next/server';
import { setAccessCookie } from '../../../../lib/server-auth';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

export async function POST(req: Request) {
  const { email, password } = await req.json();

  const apiRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });

  const body = await apiRes.json().catch(() => null);

  if (!apiRes.ok) {
    return NextResponse.json(body ?? { message: 'Login failed' }, { status: apiRes.status });
  }

  await setAccessCookie(body.accessToken);

  return NextResponse.json({ ok: true, user: body.user });
}
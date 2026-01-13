import { NextResponse } from 'next/server';
import { clearAccessCookie } from '../../../../lib/server-auth';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

export async function POST() {
  await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  }).catch(() => null);

  await clearAccessCookie();
  return NextResponse.json({ ok: true });
}
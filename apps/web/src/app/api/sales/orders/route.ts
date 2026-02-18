import { NextResponse } from 'next/server';
import { apiFetchServer } from '../../../../lib/server-api';

export async function GET() {
  const data = await apiFetchServer(`/sales/orders`, { method: 'GET' });
  return NextResponse.json(data);
}
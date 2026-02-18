import { NextResponse } from 'next/server';
import { apiFetchServer } from '../../../../lib/server-api';

export async function GET() {
  const data = await apiFetchServer(`/sales/invoices`, { method: 'GET' });
  return NextResponse.json(data);
}
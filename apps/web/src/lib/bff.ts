import { NextResponse } from 'next/server';

/**
 * Wraps a BFF handler so that API errors are returned to the browser with:
 * - correct HTTP status code
 * - a JSON body containing message + details
 *
 * This prevents "throw => 500" and lets UI show human-friendly error text.
 */
export async function bffJson<T>(fn: () => Promise<T>) {
  try {
    const data = await fn();
    return NextResponse.json(data);
  } catch (e: any) {
    // apiFetchServer throws Error(msg). No status is preserved.
    // We recover a best-effort status by parsing common prefixes if you later add them,
    // otherwise default to 400.
    const raw = String(e?.message ?? 'Request failed').trim();

    // Heuristic: if message looks like "API 403" etc.
    const m = raw.match(/^API\s+(\d{3})\b/);
    const status = m ? Number(m[1]) : 400;

    return NextResponse.json(
      {
        ok: false,
        message: raw,
      },
      { status },
    );
  }
}
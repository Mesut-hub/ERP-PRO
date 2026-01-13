'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type LedgerMeta = {
  skip: number;
  take: number;
  total: number;
};

function buildQuery(params: Record<string, string | number | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    const s = String(v).trim();
    if (!s) continue;
    sp.set(k, s);
  }
  return sp.toString();
}

function toInt(v: string | null, def: number) {
  if (v === null || v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

export default function LedgerPage() {
  const searchParams = useSearchParams();
  const initializedFromUrl = useRef(false);

  const [accountCode, setAccountCode] = useState('328');
  const [sourceType, setSourceType] = useState<string>('');
  const [partyId, setPartyId] = useState<string>('');
  const [from, setFrom] = useState<string>(''); // YYYY-MM-DD
  const [to, setTo] = useState<string>(''); // YYYY-MM-DD

  const [take, setTake] = useState<number>(200);
  const [skip, setSkip] = useState<number>(0);

  const [data, setData] = useState<any | null>(null);
  const [meta, setMeta] = useState<LedgerMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize state from URL query params ONCE
  useEffect(() => {
    if (initializedFromUrl.current) return;

    const qAccountCode = searchParams.get('accountCode');
    const qSourceType = searchParams.get('sourceType');
    const qPartyId = searchParams.get('partyId');
    const qFrom = searchParams.get('from');
    const qTo = searchParams.get('to');
    const qTake = searchParams.get('take');
    const qSkip = searchParams.get('skip');

    if (qAccountCode) setAccountCode(qAccountCode);
    if (qSourceType) setSourceType(qSourceType);
    if (qPartyId) setPartyId(qPartyId);
    if (qFrom) setFrom(qFrom);
    if (qTo) setTo(qTo);

    if (qTake) setTake(Math.min(1000, Math.max(1, toInt(qTake, 200))));
    if (qSkip) setSkip(Math.max(0, toInt(qSkip, 0)));

    initializedFromUrl.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const queryString = useMemo(
    () =>
      buildQuery({
        accountCode,
        sourceType: sourceType || undefined,
        partyId: partyId || undefined,
        from: from || undefined,
        to: to || undefined,
        take,
        skip,
      }),
    [accountCode, sourceType, partyId, from, to, take, skip],
  );

  async function load() {
    setError(null);
    setData(null);

    const res = await fetch(`/api/acc/reports/ledger?${queryString}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.message ?? 'Failed to load ledger');

    setData(body);
    setMeta(body.meta ?? null);
  }

  // Load when initializedFromUrl has been applied once (so deep links work)
  useEffect(() => {
    if (!initializedFromUrl.current) return;
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initializedFromUrl.current]);

  function onApplyFilters() {
    setSkip(0);
    load().catch((e) => setError(e.message));
  }

  function canPrev() {
    return (meta?.skip ?? skip) > 0;
  }

  function canNext() {
    if (!meta) return false;
    return meta.skip + meta.take < meta.total;
  }

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Ledger</h1>

      <p>
        <a href="/">Home</a> | <a href="/accounting/trial-balance">Trial Balance</a> |{' '}
        <a href="/accounting/grni">GRNI</a>
      </p>

      <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Filters</h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          <div>
            <label>Account code</label>
            <input
              style={{ width: '100%', padding: 8, display: 'block' }}
              value={accountCode}
              onChange={(e) => setAccountCode(e.target.value)}
            />
          </div>

          <div>
            <label>Source type (optional)</label>
            <input
              style={{ width: '100%', padding: 8, display: 'block' }}
              placeholder="PurchaseReturn / SupplierInvoice / ..."
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value)}
            />
          </div>

          <div>
            <label>Party ID (optional)</label>
            <input
              style={{ width: '100%', padding: 8, display: 'block' }}
              placeholder="partyId"
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
            />
          </div>

          <div>
            <label>From (YYYY-MM-DD)</label>
            <input
              style={{ width: '100%', padding: 8, display: 'block' }}
              placeholder="2026-01-01"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>

          <div>
            <label>To (YYYY-MM-DD)</label>
            <input
              style={{ width: '100%', padding: 8, display: 'block' }}
              placeholder="2026-12-31"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>

          <div>
            <label>Page size (take)</label>
            <select
              style={{ width: '100%', padding: 8, display: 'block' }}
              value={take}
              onChange={(e) => setTake(Number(e.target.value))}
            >
              {[50, 100, 200, 500].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={onApplyFilters}>Apply</button>

          <span style={{ marginLeft: 12, fontSize: 12, color: '#555' }}>
            Query: <code>{queryString}</code>
          </span>

          <div style={{ marginLeft: 'auto' }}>
            Quick accounts:{' '}
            {['150', '320', '327', '328', '191', '770'].map((c) => (
              <button
                key={c}
                style={{ marginRight: 6 }}
                onClick={() => {
                  setAccountCode(c);
                  setSkip(0);
                  setTimeout(() => load().catch((e) => setError(e.message)), 0);
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section style={{ marginTop: 12 }}>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        {!data && !error && <p>Loading...</p>}

        {data && (
          <>
            <h2>
              {data.account.code} - {data.account.name}
            </h2>

            {meta && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <button
                  disabled={!canPrev()}
                  onClick={() => {
                    const nextSkip = Math.max(0, meta.skip - meta.take);
                    setSkip(nextSkip);
                    setTimeout(() => load().catch((e) => setError(e.message)), 0);
                  }}
                >
                  Prev
                </button>

                <button
                  disabled={!canNext()}
                  onClick={() => {
                    const nextSkip = meta.skip + meta.take;
                    setSkip(nextSkip);
                    setTimeout(() => load().catch((e) => setError(e.message)), 0);
                  }}
                >
                  Next
                </button>

                <span style={{ fontSize: 12, color: '#555' }}>
                  Showing {meta.total === 0 ? 0 : meta.skip + 1}-
                  {Math.min(meta.skip + meta.take, meta.total)} of {meta.total}
                </span>
              </div>
            )}

            <table cellPadding={8} style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th align="left">Date</th>
                  <th align="left">JE No</th>
                  <th align="left">Description</th>
                  <th align="left">Source</th>
                  <th align="right">Debit</th>
                  <th align="right">Credit</th>
                  <th align="right">Running (page)</th>
                </tr>
              </thead>
              <tbody>
                {(data.rows ?? []).map((r: any) => (
                  <tr key={r.line.id} style={{ borderTop: '1px solid #ddd' }}>
                    <td>{new Date(r.journalEntry.documentDate).toISOString().slice(0, 10)}</td>
                    <td>{r.journalEntry.documentNo}</td>
                    <td>{r.journalEntry.description ?? r.line.description ?? ''}</td>
                    <td style={{ fontFamily: 'monospace' }}>
                      {(() => {
                        const st = r.journalEntry.sourceType;
                        const sid = r.journalEntry.sourceId;

                        if (st === 'PurchaseReturn' && sid) {
                          return (
                            <a href={`/purchasing/returns/${encodeURIComponent(sid)}`}>
                              {st}:{sid}
                            </a>
                          );
                        }
                        if (st === 'SupplierInvoice' && sid) {
                          return (
                            <a href={`/purchasing/invoices/${encodeURIComponent(sid)}`}>
                              {st}:{sid}
                            </a>
                          );
                        }

                        return (
                          <span>
                            {st ?? '-'}:{sid ?? '-'}
                          </span>
                        );
                      })()}
                    </td>
                    <td align="right">{Number(r.line.debit ?? 0).toFixed(2)}</td>
                    <td align="right">{Number(r.line.credit ?? 0).toFixed(2)}</td>
                    <td align="right">{Number(r.runningBalance ?? 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </main>
  );
}
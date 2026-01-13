'use client';

import { useEffect, useMemo, useState } from 'react';

function buildQuery(params: Record<string, string | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    const s = String(v).trim();
    if (!s) continue;
    sp.set(k, s);
  }
  return sp.toString();
}

export default function GrniPage() {
  const [supplierId, setSupplierId] = useState<string>('');
  const [from, setFrom] = useState<string>(''); // optional
  const [to, setTo] = useState<string>(''); // optional
  const [onlyNonZero, setOnlyNonZero] = useState<boolean>(true);

  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const qs = useMemo(
    () =>
      buildQuery({
        supplierId: supplierId || undefined,
        from: from || undefined,
        to: to || undefined,
        onlyNonZero: onlyNonZero ? 'true' : 'false',
      }),
    [supplierId, from, to, onlyNonZero],
  );

  async function load() {
    setError(null);
    setData(null);

    const res = await fetch(`/api/acc/reports/grni?${qs}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.message ?? 'Failed to load GRNI report');

    setData(body);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>GRNI Reconciliation (327)</h1>

      <p>
        <a href="/">Home</a> | <a href="/accounting/ledger">Ledger</a> |{' '}
        <a href="/accounting/trial-balance">Trial Balance</a>
      </p>

      <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Filters</h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
          <div>
            <label>Supplier ID (optional)</label>
            <input
              style={{ width: '100%', padding: 8, display: 'block' }}
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              placeholder="partyId"
            />
          </div>

          <div>
            <label>From (YYYY-MM-DD)</label>
            <input
              style={{ width: '100%', padding: 8, display: 'block' }}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="(default: year start)"
            />
          </div>

          <div>
            <label>To (YYYY-MM-DD)</label>
            <input
              style={{ width: '100%', padding: 8, display: 'block' }}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="(default: today)"
            />
          </div>

          <div>
            <label>Only non-zero</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', height: 42 }}>
              <input
                type="checkbox"
                checked={onlyNonZero}
                onChange={(e) => setOnlyNonZero(e.target.checked)}
              />
              <span>{onlyNonZero ? 'true' : 'false'}</span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => load().catch((e) => setError(e.message))}>Apply</button>
          <span style={{ marginLeft: 12, fontSize: 12, color: '#555' }}>
            Query: <code>{qs}</code>
          </span>
        </div>
      </section>

      <section style={{ marginTop: 12 }}>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        {!data && !error && <p>Loading...</p>}

        {data && (
          <>
            <h2>
              Account {data.account.code} - {data.account.name}
            </h2>
            {data.meta && (
              <p style={{ color: '#555', fontSize: 12 }}>
                Effective range: <code>{data.meta.from}</code> → <code>{data.meta.to}</code>, onlyNonZero:{' '}
                <code>{String(data.meta.onlyNonZero)}</code>
              </p>
            )}

            <table cellPadding={8} style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th align="left">Supplier</th>
                  <th align="right">Debit</th>
                  <th align="right">Credit</th>
                  <th align="right">Net</th>
                  <th align="left">Drilldown</th>
                </tr>
              </thead>
              <tbody>
                {(data.rows ?? []).map((r: any, idx: number) => (
                  <tr key={idx} style={{ borderTop: '1px solid #ddd' }}>
                    <td>
                      {r.supplierName ?? '(unknown)'}{' '}
                      <span style={{ color: '#777', fontSize: 12 }}>
                        {r.supplierId ?? '(no partyId)'}
                      </span>
                    </td>
                    <td align="right">{Number(r.debit ?? 0).toFixed(2)}</td>
                    <td align="right">{Number(r.credit ?? 0).toFixed(2)}</td>
                    <td align="right">{Number(r.net ?? 0).toFixed(2)}</td>
                    <td>
                      {r.supplierId ? (
                        <a
                          href={`/accounting/ledger?accountCode=327&partyId=${encodeURIComponent(
                            r.supplierId,
                          )}`}
                        >
                          View ledger
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
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
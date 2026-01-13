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

export default function TrialBalancePage() {
  const [accountType, setAccountType] = useState<string>(''); // e.g. ASSET/LIABILITY/INCOME/EXPENSE
  const [onlyNonZero, setOnlyNonZero] = useState<boolean>(true);
  const [from, setFrom] = useState<string>(''); // YYYY-MM-DD
  const [to, setTo] = useState<string>(''); // YYYY-MM-DD

  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queryString = useMemo(
    () =>
      buildQuery({
        accountType: accountType || undefined,
        onlyNonZero: onlyNonZero ? 'true' : 'false',
        from: from || undefined,
        to: to || undefined,
      }),
    [accountType, onlyNonZero, from, to],
  );

  async function load() {
    setError(null);
    setRows(null);

    const res = await fetch(`/api/acc/reports/trial-balance?${queryString}`);
    const body = await res.json().catch(() => null);

    if (!res.ok) throw new Error(body?.message ?? 'Failed to load trial balance');
    setRows(body.rows ?? []);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Trial Balance</h1>

      <p>
        <a href="/">Home</a> | <a href="/accounting/ledger">Ledger</a>
      </p>

      <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Filters</h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
          <div>
            <label>Account type</label>
            <select
              style={{ width: '100%', padding: 8, display: 'block' }}
              value={accountType}
              onChange={(e) => setAccountType(e.target.value)}
            >
              <option value="">(all)</option>
              <option value="ASSET">ASSET</option>
              <option value="LIABILITY">LIABILITY</option>
              <option value="EQUITY">EQUITY</option>
              <option value="INCOME">INCOME</option>
              <option value="EXPENSE">EXPENSE</option>
            </select>
            <small style={{ color: '#555' }}>
              Values must match API enum <code>AccountType</code>.
            </small>
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
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => {
              load().catch((e) => setError(e.message));
            }}
          >
            Apply
          </button>

          <span style={{ marginLeft: 12, fontSize: 12, color: '#555' }}>
            Query: <code>{queryString}</code>
          </span>
        </div>
      </section>

      <section style={{ marginTop: 12 }}>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        {!rows && !error && <p>Loading...</p>}

        {rows && (
          <table cellPadding={8} style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th align="left">Code</th>
                <th align="left">Name</th>
                <th align="left">Type</th>
                <th align="right">Debit</th>
                <th align="right">Credit</th>
                <th align="right">Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} style={{ borderTop: '1px solid #ddd' }}>
                  <td>{r.accountCode}</td>
                  <td>{r.accountName}</td>
                  <td>{r.accountType}</td>
                  <td align="right">{Number(r.debit).toFixed(2)}</td>
                  <td align="right">{Number(r.credit).toFixed(2)}</td>
                  <td align="right">{Number(r.net).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
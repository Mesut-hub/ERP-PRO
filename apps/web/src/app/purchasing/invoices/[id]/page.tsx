'use client';

import { useEffect, useState } from 'react';

export default function SupplierInvoiceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    const res = await fetch(`/api/pur/invoices/${encodeURIComponent(params.id)}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.message ?? 'Failed to load supplier invoice');
    setData(body);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Supplier Invoice / Note</h1>
      <p>
        <a href="/accounting/ledger">Back to ledger</a>
      </p>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {!data && !error && <p>Loading...</p>}

      {data && (
        <>
          <h2 style={{ marginBottom: 8 }}>
            {data.documentNo ?? '(no documentNo)'}{' '}
            <span style={{ color: '#666', fontSize: 12 }}>id={params.id}</span>
          </h2>

          <ul>
            <li>Kind: {data.kind ?? '-'}</li>
            <li>Status: {data.status ?? '-'}</li>
            <li>Document date: {data.documentDate ? new Date(data.documentDate).toISOString().slice(0, 10) : '-'}</li>
            <li>PO: {data.poId ?? '-'}</li>
            <li>Note of: {data.noteOfId ?? '-'}</li>
            <li>Journal Entry: {data.journalEntry?.id ?? '-'}</li>
          </ul>

          <h3>Raw JSON</h3>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(data, null, 2)}</pre>
        </>
      )}
    </main>
  );
}
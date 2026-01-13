'use client';

import { useEffect, useState } from 'react';

export default function PurchaseReturnDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    const res = await fetch(`/api/pur/returns/${encodeURIComponent(params.id)}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.message ?? 'Failed to load purchase return');
    setData(body);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Purchase Return</h1>
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

          {/* Minimal “professional” key fields */}
          <ul>
            <li>Document date: {data.documentDate ? new Date(data.documentDate).toISOString().slice(0, 10) : '-'}</li>
            <li>Receipt: {data.receiptId ?? '-'}</li>
            <li>Warehouse: {data.warehouseId ?? '-'}</li>
            <li>Supplier credit note: {data.supplierCreditNoteId ?? '-'}</li>
            <li>Stock move: {data.stockMoveId ?? '-'}</li>
          </ul>

          <h3>Raw JSON</h3>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(data, null, 2)}</pre>
        </>
      )}
    </main>
  );
}
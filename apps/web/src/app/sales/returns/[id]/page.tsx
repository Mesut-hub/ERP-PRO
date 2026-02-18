'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export default function SalesReturnDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [doc, setDoc] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/sales/returns/${encodeURIComponent(id)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Failed to load return');
      setDoc(body);
    } catch (e: any) {
      setDoc(null);
      setError(e?.message ?? 'Failed to load return');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Sales Return</h1>
          <p className="text-sm text-muted-foreground">Return details.</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}

      {loading && (
        <Card>
          <CardHeader>
            <CardTitle>Loading</CardTitle>
            <CardDescription>Fetching return…</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      )}

      {!loading && doc && (
        <Card>
          <CardHeader>
            <CardTitle>Header</CardTitle>
            <CardDescription>Document info.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm grid grid-cols-1 md:grid-cols-2 gap-2">
            <div><span className="text-muted-foreground">Document:</span> <span className="font-mono">{doc.documentNo}</span></div>
            <div><span className="text-muted-foreground">Date:</span> <span className="font-mono">{String(doc.documentDate).slice(0, 10)}</span></div>
            <div><span className="text-muted-foreground">Delivery:</span> <span className="font-mono">{doc.delivery?.documentNo ?? doc.deliveryId}</span></div>
            <div><span className="text-muted-foreground">Warehouse:</span> <span className="font-mono">{doc.warehouse?.code ?? doc.warehouseId}</span></div>
          </CardContent>
        </Card>
      )}

      {!loading && doc?.lines && (
        <Card>
          <CardHeader>
            <CardTitle>Lines</CardTitle>
            <CardDescription>Returned quantities and costs (from delivery snapshot).</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                    <th>Product</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Unit cost (TRY)</th>
                    <th className="text-right">Line cost (TRY)</th>
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-t [&>tr]:border-border">
                  {doc.lines.map((l: any) => (
                    <tr key={l.id} className="[&>td]:px-3 [&>td]:py-2">
                      <td className="font-mono text-xs">{l.productId}</td>
                      <td className="text-right tabular-nums">{Number(l.quantity ?? 0).toFixed(4)}</td>
                      <td className="text-right tabular-nums">{Number(l.unitCost ?? 0).toFixed(6)}</td>
                      <td className="text-right tabular-nums">{Number(l.lineCost ?? 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
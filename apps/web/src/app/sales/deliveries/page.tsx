'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export default function DeliveriesListPage() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/sales/deliveries');
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Failed to load deliveries');
      setRows(Array.isArray(body) ? body : []);
    } catch (e: any) {
      setRows(null);
      setError(e?.message ?? 'Failed to load deliveries');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Deliveries</h1>
          <p className="text-sm text-muted-foreground">Recent sales deliveries.</p>
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
            <CardDescription>Fetching deliveries…</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      )}

      {!loading && rows && (
        <Card>
          <CardHeader>
            <CardTitle>List</CardTitle>
            <CardDescription>Showing latest 100 deliveries.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                    <th>Document</th>
                    <th>Date</th>
                    <th>Warehouse</th>
                    <th className="text-right">Lines</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-t [&>tr]:border-border">
                  {rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-muted-foreground" colSpan={5}>
                        No deliveries found.
                      </td>
                    </tr>
                  ) : (
                    rows.map((d) => (
                      <tr key={d.id} className="[&>td]:px-3 [&>td]:py-2">
                        <td className="font-mono">{d.documentNo}</td>
                        <td className="font-mono text-xs text-muted-foreground">
                          {String(d.documentDate).slice(0, 10)}
                        </td>
                        <td className="text-sm">
                          {d.warehouse?.code ? `${d.warehouse.code} — ${d.warehouse.name}` : d.warehouseId}
                        </td>
                        <td className="text-right tabular-nums">{(d.lines ?? []).length}</td>
                        <td className="text-right">
                          <Link className="underline underline-offset-4" href={`/sales/deliveries/${d.id}`}>
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export default function InventoryMovesListPage() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/inv/moves');
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Failed to load stock moves');
      setRows(Array.isArray(body) ? body : []);
    } catch (e: any) {
      setRows(null);
      setError(e?.message ?? 'Failed to load stock moves');
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
          <h1 className="text-xl font-semibold">Stock Moves</h1>
          <p className="text-sm text-muted-foreground">Receipts, issues, transfers, adjustments.</p>
        </div>
        <div className="flex gap-2">
          <Link className="self-center underline underline-offset-4" href="/inventory/moves/new/receipt">
            New Receipt
          </Link>
          <Button variant="outline" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}

      {loading && (
        <Card>
          <CardHeader>
            <CardTitle>Loading</CardTitle>
            <CardDescription>Fetching moves…</CardDescription>
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
            <CardTitle>Latest</CardTitle>
            <CardDescription>Last 100 stock moves.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                    <th>Document</th>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th className="text-right">Lines</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-t [&>tr]:border-border">
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-3 text-muted-foreground">
                        No stock moves found.
                      </td>
                    </tr>
                  ) : (
                    rows.map((m) => (
                      <tr key={m.id} className="[&>td]:px-3 [&>td]:py-2">
                        <td className="font-mono">{m.documentNo}</td>
                        <td className="font-mono text-xs text-muted-foreground">
                          {String(m.documentDate).slice(0, 10)}
                        </td>
                        <td className="font-mono text-xs">{m.type}</td>
                        <td className="font-mono text-xs">{m.status}</td>
                        <td className="text-right tabular-nums">{(m.lines ?? []).length}</td>
                        <td className="text-right">
                          <Link className="underline underline-offset-4" href={`/inventory/moves/${m.id}`}>
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
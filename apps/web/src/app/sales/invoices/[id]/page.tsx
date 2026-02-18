'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

export default function SalesInvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [inv, setInv] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  async function load() {
    setError(null);
    setOk(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/sales/invoices/${encodeURIComponent(id)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Failed to load invoice');
      setInv(body);
    } catch (e: any) {
      setInv(null);
      setError(e?.message ?? 'Failed to load invoice');
    } finally {
      setLoading(false);
    }
  }

  async function post() {
    setError(null);
    setOk(null);
    setPosting(true);
    try {
      const res = await fetch(`/api/sales/invoices/${encodeURIComponent(id)}/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: overrideReason || undefined }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Post failed');
      setOk(`Posted. JournalEntryId=${body?.journalEntryId ?? ''}`);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Post failed');
    } finally {
      setPosting(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Customer Invoice</h1>
          <p className="text-sm text-muted-foreground">Invoice details and posting.</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading || posting}>
          Refresh
        </Button>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}
      {ok && <Alert>{ok}</Alert>}

      {loading && (
        <Card>
          <CardHeader>
            <CardTitle>Loading</CardTitle>
            <CardDescription>Fetching invoice…</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      )}

      {!loading && inv && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Header</CardTitle>
              <CardDescription>Document info.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm grid grid-cols-1 md:grid-cols-2 gap-2">
              <div><span className="text-muted-foreground">Document:</span> <span className="font-mono">{inv.documentNo}</span></div>
              <div><span className="text-muted-foreground">Status:</span> <span className="font-mono">{inv.status}</span></div>
              <div><span className="text-muted-foreground">Date:</span> <span className="font-mono">{String(inv.documentDate).slice(0, 10)}</span></div>
              <div><span className="text-muted-foreground">Customer:</span> <span>{inv.customer?.name ?? inv.customerId}</span></div>
              <div><span className="text-muted-foreground">Total:</span> <span className="font-mono">{Number(inv.grandTotal ?? 0).toFixed(2)} {inv.currencyCode}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lines</CardTitle>
              <CardDescription>Invoice lines.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                      <th>Description</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Unit price</th>
                      <th className="text-right">Subtotal</th>
                      <th className="text-right">VAT</th>
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="[&>tr]:border-t [&>tr]:border-border">
                    {(inv.lines ?? []).map((l: any) => (
                      <tr key={l.id} className="[&>td]:px-3 [&>td]:py-2">
                        <td>{l.description}</td>
                        <td className="text-right tabular-nums">{Number(l.quantity ?? 0).toFixed(4)}</td>
                        <td className="text-right tabular-nums">{Number(l.unitPrice ?? 0).toFixed(4)}</td>
                        <td className="text-right tabular-nums">{Number(l.lineSubtotal ?? 0).toFixed(2)}</td>
                        <td className="text-right tabular-nums">{Number(l.lineVat ?? 0).toFixed(2)}</td>
                        <td className="text-right tabular-nums">{Number(l.lineTotal ?? 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Post</CardTitle>
              <CardDescription>Post the invoice to accounting.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label>Override reason (optional)</Label>
              <Input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Reason if posting lock override is used" />
              <Button onClick={post} disabled={posting}>
                {posting ? 'Posting…' : 'Post invoice'}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
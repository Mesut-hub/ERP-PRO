'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

export default function StockMoveDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [move, setMove] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'post' | 'cancel' | 'reverse' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [postNotes, setPostNotes] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  async function load() {
    setError(null);
    setOk(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/inv/moves/${encodeURIComponent(id)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Failed to load stock move');
      setMove(body);
    } catch (e: any) {
      setMove(null);
      setError(e?.message ?? 'Failed to load stock move');
    } finally {
      setLoading(false);
    }
  }

  async function post() {
    setError(null);
    setOk(null);
    setBusy('post');
    try {
      const res = await fetch(`/api/inv/moves/${encodeURIComponent(id)}/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: postNotes || undefined,
          reason: overrideReason || undefined, // posting lock override reason
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Post failed');
      setOk('Posted.');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Post failed');
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    setError(null);
    setOk(null);
    setBusy('cancel');
    try {
      const res = await fetch(`/api/inv/moves/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Cancel failed');
      setOk('Canceled.');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Cancel failed');
    } finally {
      setBusy(null);
    }
  }

  async function reverse() {
    setError(null);
    setOk(null);
    setBusy('reverse');
    try {
      const res = await fetch(`/api/inv/moves/${encodeURIComponent(id)}/reverse`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Reverse failed');

      const newId = body?.id ?? null;
      setOk('Reversal created.');
      if (newId) {
        router.push(`/inventory/moves/${newId}`);
        router.refresh();
        return;
      }
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Reverse failed');
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Stock Move</h1>
          <p className="text-sm text-muted-foreground">Detail + posting.</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading || busy !== null}>
          Refresh
        </Button>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}
      {ok && <Alert>{ok}</Alert>}

      {loading && (
        <Card>
          <CardHeader>
            <CardTitle>Loading</CardTitle>
            <CardDescription>Fetching stock move…</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      )}

      {!loading && move && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Header</CardTitle>
              <CardDescription>Move metadata.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <span className="text-muted-foreground">Document:</span>{' '}
                <span className="font-mono">{move.documentNo}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Status:</span>{' '}
                <span className="font-mono">{move.status}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Type:</span>{' '}
                <span className="font-mono">{move.type}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Date:</span>{' '}
                <span className="font-mono">{String(move.documentDate).slice(0, 10)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">From:</span>{' '}
                <span className="font-mono">{move.fromWarehouse?.code ?? move.fromWarehouseId ?? ''}</span>
              </div>
              <div>
                <span className="text-muted-foreground">To:</span>{' '}
                <span className="font-mono">{move.toWarehouse?.code ?? move.toWarehouseId ?? ''}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lines</CardTitle>
              <CardDescription>Products and quantities.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                      <th>Product</th>
                      <th>Unit</th>
                      <th className="text-right">Qty</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody className="[&>tr]:border-t [&>tr]:border-border">
                    {(move.lines ?? []).map((l: any) => (
                      <tr key={l.id} className="[&>td]:px-3 [&>td]:py-2">
                        <td className="font-mono text-xs">{l.productId}</td>
                        <td className="font-mono text-xs">{l.unitId}</td>
                        <td className="text-right tabular-nums">{Number(l.quantity ?? 0).toFixed(4)}</td>
                        <td className="text-xs">{l.notes ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
              <CardDescription>
                Posting enforces posting locks. Override requires permission <code>fin.posting.override</code> and 15+
                chars reason.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label>Post notes (optional)</Label>
              <Input value={postNotes} onChange={(e) => setPostNotes(e.target.value)} />

              <Label>Posting lock override reason (optional)</Label>
              <Input
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Only needed if posting is locked (min 15 chars)"
              />

              <div className="flex gap-2">
                <Button onClick={post} disabled={busy !== null}>
                  {busy === 'post' ? 'Posting…' : 'Post'}
                </Button>
                <Button variant="outline" onClick={cancel} disabled={busy !== null}>
                  {busy === 'cancel' ? 'Canceling…' : 'Cancel'}
                </Button>
                <Button variant="outline" onClick={reverse} disabled={busy !== null}>
                  {busy === 'reverse' ? 'Reversing…' : 'Reverse'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type AllocationRow = {
  id: string;
  createdAt: string;
  productId: string;
  productSku: string;
  productName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  quantity: string;
  unitCostBase: string;
  amountBase: string;
  layer: {
    id: string;
    receivedAt: string;
    sourceType: string;
    sourceId: string;
    sourceLineId: string | null;
    sourceCurrencyCode: string | null;
    unitCostTxn: string | null;
    fxRateToTry: string | null;
    unitCostBase: string;
  };
};

function sumMoney(xs: Array<number>) {
  const total = xs.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

function n4(x: any) {
  const v = Number(x ?? 0);
  return Number.isFinite(v) ? v : 0;
}

export default function SalesDeliveryPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const deliveryId = params.id;

  const [delivery, setDelivery] = useState<any | null>(null);
  const [alloc, setAlloc] = useState<{ totals: any; rows: AllocationRow[] } | null>(null);

  const [loading, setLoading] = useState(false);
  const [busyReturn, setBusyReturn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [returnReason, setReturnReason] = useState('Customer return');
  const [returnNotes, setReturnNotes] = useState('');
  const [returnQtyByDeliveryLineId, setReturnQtyByDeliveryLineId] = useState<Record<string, string>>(
    {},
  );

  async function load() {
    setError(null);
    setOk(null);
    setLoading(true);
    try {
      const [dRes, aRes] = await Promise.all([
        fetch(`/api/sales/deliveries/${encodeURIComponent(deliveryId)}`),
        fetch(
          `/api/inv/reports/fifo-allocations?issueSourceType=SalesDelivery&issueSourceId=${encodeURIComponent(
            deliveryId,
          )}`,
        ),
      ]);

      const dBody = await dRes.json().catch(() => null);
      if (!dRes.ok) throw new Error(dBody?.message ?? 'Failed to load delivery');

      const aBody = await aRes.json().catch(() => null);
      if (!aRes.ok) throw new Error(aBody?.message ?? 'Failed to load COGS allocations');

      setDelivery(dBody);
      setAlloc({ totals: aBody?.totals, rows: aBody?.rows ?? [] });

      // initialize return qty map (default 0)
      const lines: any[] = Array.isArray(dBody?.lines) ? dBody.lines : [];
      const init: Record<string, string> = {};
      for (const l of lines) init[l.id] = init[l.id] ?? '0';
      setReturnQtyByDeliveryLineId((prev) => ({ ...init, ...prev }));
    } catch (e: any) {
      setDelivery(null);
      setAlloc(null);
      setError(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryId]);

  const deliveryCost = useMemo(() => {
    const lines: any[] = Array.isArray(delivery?.lines) ? delivery.lines : [];
    return sumMoney(lines.map((l) => Number(l?.lineCost ?? 0)));
  }, [delivery]);

  const allocCost = useMemo(() => {
    const rows: AllocationRow[] = Array.isArray(alloc?.rows) ? alloc!.rows : [];
    return sumMoney(rows.map((r) => Number(r?.amountBase ?? 0)));
  }, [alloc]);

  const diff = useMemo(() => {
    return Math.round((deliveryCost - allocCost + Number.EPSILON) * 100) / 100;
  }, [deliveryCost, allocCost]);

  const match = Math.abs(diff) <= 0.01;

  async function createReturn() {
    setError(null);
    setOk(null);

    const lines: any[] = Array.isArray(delivery?.lines) ? delivery.lines : [];
    const payloadLines = lines
      .map((l) => ({
        deliveryLineId: l.id,
        quantity: String(returnQtyByDeliveryLineId[l.id] ?? '0').trim(),
        notes: undefined,
      }))
      .filter((x) => n4(x.quantity) > 0);

    if (payloadLines.length === 0) {
      setError('Nothing to return. Enter a quantity > 0 for at least one delivery line.');
      return;
    }

    setBusyReturn(true);
    try {
      const res = await fetch(`/api/sales/deliveries/${encodeURIComponent(deliveryId)}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: returnReason,
          notes: returnNotes || undefined,
          lines: payloadLines,
        }),
      });

      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Failed to create return');

      const salesReturnId = body?.salesReturnId ?? body?.id ?? null;
      setOk(`Return created. ${salesReturnId ? `Opening ${salesReturnId}…` : ''}`);

      if (salesReturnId) {
        router.push(`/sales/returns/${salesReturnId}`);
        router.refresh();
        return;
      }

      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create return');
    } finally {
      setBusyReturn(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Delivery</h1>
          <p className="text-sm text-muted-foreground">Delivery details and FIFO COGS audit.</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading || busyReturn}>
          Refresh
        </Button>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}
      {ok && <Alert>{ok}</Alert>}

      {loading && (
        <Card>
          <CardHeader>
            <CardTitle>Loading</CardTitle>
            <CardDescription>Fetching delivery + allocations…</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      )}

      {!loading && delivery && (
        <Card>
          <CardHeader>
            <CardTitle>Header</CardTitle>
            <CardDescription>High-level delivery info.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <span className="text-muted-foreground">ID:</span>{' '}
              <span className="font-mono">{delivery.id}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Document No:</span>{' '}
              <span className="font-mono">{delivery.documentNo ?? ''}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Date:</span>{' '}
              <span className="font-mono">{String(delivery.documentDate ?? '').slice(0, 10)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">SO:</span>{' '}
              <span className="font-mono">{delivery.soId ?? ''}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Warehouse:</span>{' '}
              <span className="font-mono">{delivery.warehouseId ?? ''}</span>
            </div>
            <div>
              <span className="text-muted-foreground">StockMove:</span>{' '}
              <span className="font-mono">{delivery.stockMoveId ?? ''}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && delivery?.lines && (
        <Card>
          <CardHeader>
            <CardTitle>Lines</CardTitle>
            <CardDescription>Delivered quantities and cost snapshot (if present).</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                    <th>Product</th>
                    <th className="text-right">Qty</th>
                    <th>Unit</th>
                    <th className="text-right">Unit cost (TRY)</th>
                    <th className="text-right">Line cost (TRY)</th>
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-t [&>tr]:border-border">
                  {delivery.lines.map((l: any) => (
                    <tr key={l.id} className="[&>td]:px-3 [&>td]:py-2">
                      <td className="font-mono text-xs">{l.productId}</td>
                      <td className="text-right tabular-nums">{Number(l.quantity ?? 0).toFixed(4)}</td>
                      <td className="font-mono text-xs">{l.unitId}</td>
                      <td className="text-right tabular-nums">
                        {l.unitCost !== null && l.unitCost !== undefined ? Number(l.unitCost).toFixed(6) : ''}
                      </td>
                      <td className="text-right tabular-nums">
                        {l.lineCost !== null && l.lineCost !== undefined ? Number(l.lineCost).toFixed(2) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 text-sm">
              <div>
                <span className="text-muted-foreground">Delivery line cost total:</span>{' '}
                <span className="font-mono">{deliveryCost.toFixed(2)} TRY</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* NEW: Return creation */}
      {!loading && delivery?.lines && (
        <Card>
          <CardHeader>
            <CardTitle>Create Return</CardTitle>
            <CardDescription>Create a sales return against this delivery.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Reason</Label>
                <Input value={returnReason} onChange={(e) => setReturnReason(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Input value={returnNotes} onChange={(e) => setReturnNotes(e.target.value)} />
              </div>
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                    <th>Delivery line</th>
                    <th>Product</th>
                    <th className="text-right">Delivered</th>
                    <th className="text-right">Return qty</th>
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-t [&>tr]:border-border">
                  {delivery.lines.map((l: any) => (
                    <tr key={l.id} className="[&>td]:px-3 [&>td]:py-2">
                      <td className="font-mono text-xs">{l.id}</td>
                      <td className="font-mono text-xs">{l.productId}</td>
                      <td className="text-right tabular-nums">{Number(l.quantity ?? 0).toFixed(4)}</td>
                      <td className="text-right">
                        <Input
                          className="w-[140px] ml-auto text-right"
                          value={returnQtyByDeliveryLineId[l.id] ?? '0'}
                          onChange={(e) =>
                            setReturnQtyByDeliveryLineId((prev) => ({ ...prev, [l.id]: e.target.value }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Button onClick={createReturn} disabled={busyReturn}>
              {busyReturn ? 'Creating…' : 'Create Return'}
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && alloc && (
        <Card>
          <CardHeader>
            <CardTitle>COGS (FIFO Allocations)</CardTitle>
            <CardDescription>
              Total allocations: <code>{allocCost.toFixed(2)} TRY</code> · Lines:{' '}
              <code>{alloc.totals?.lines ?? 0}</code>
              <span className="mx-2">·</span>
              Reconciliation:{' '}
              <code className={match ? 'text-foreground' : 'text-destructive'}>
                {match ? 'MATCH' : `MISMATCH (diff ${diff.toFixed(2)} TRY)`}
              </code>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                    <th>Product</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Amount (TRY)</th>
                    <th>Layer source</th>
                    <th>CCY</th>
                    <th className="text-right">Unit (CCY)</th>
                    <th className="text-right">FX→TRY</th>
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-t [&>tr]:border-border">
                  {alloc.rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-muted-foreground" colSpan={7}>
                        No FIFO allocations found for this delivery.
                      </td>
                    </tr>
                  ) : (
                    alloc.rows.map((r) => (
                      <tr key={r.id} className="[&>td]:px-3 [&>td]:py-2">
                        <td>
                          <div className="font-medium">
                            {r.productSku} — {r.productName}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">{r.productId}</div>
                        </td>
                        <td className="text-right tabular-nums">{Number(r.quantity ?? 0).toFixed(4)}</td>
                        <td className="text-right tabular-nums">{Number(r.amountBase ?? 0).toFixed(2)}</td>
                        <td className="text-xs font-mono">
                          {r.layer?.sourceType}:{r.layer?.sourceId}
                          {r.layer?.sourceLineId ? `:${r.layer.sourceLineId}` : ''}
                        </td>
                        <td className="font-mono text-xs">{r.layer?.sourceCurrencyCode ?? ''}</td>
                        <td className="text-right tabular-nums">
                          {r.layer?.unitCostTxn ? Number(r.layer.unitCostTxn).toFixed(6) : ''}
                        </td>
                        <td className="text-right tabular-nums">
                          {r.layer?.fxRateToTry ? Number(r.layer.fxRateToTry).toFixed(8) : ''}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {!match && (
              <div className="mt-3 text-xs text-muted-foreground">
                A mismatch usually means delivery line cost snapshot is missing/outdated. Use “backfill cost” on the API (
                <code>/sales/deliveries/:id/backfill-cost</code>) or ensure delivery posting writes unitCost/lineCost from
                FIFO allocations.
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

type ViewMode = 'product' | 'productWarehouse' | 'warehouseProduct';

type ValRow = {
  productId: string;
  productCode: string;
  productName: string;
  warehouseId: string | null;
  warehouseCode: string;
  warehouseName: string;
  qtyOnHand: string;
  valuationBase: string;
  avgCostBase: string;
  currencyCode: 'TRY';
};

type LayerRow = {
  id: string;
  productId: string;
  warehouseId: string;
  sourceType: string;
  sourceId: string;
  sourceLineId: string | null;
  receivedAt: string;
  qtyIn: string;
  qtyRemain: string;

  // NEW: audit fields (may be null for older rows)
  sourceCurrencyCode?: string | null;
  unitCostTxn?: string | number | null;
  fxRateToTry?: string | number | null;

  unitCostBase: string;
  createdAt: string;
};

function ymdToday() {
  return new Date().toISOString().slice(0, 10);
}

function fmtMaybe(n: any, digits: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '';
  return x.toFixed(digits);
}

export default function StockValuationPage() {
  const [asOf, setAsOf] = useState<string>(ymdToday());
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [productId, setProductId] = useState<string>('');
  const [view, setView] = useState<ViewMode>('product');

  const [data, setData] = useState<{ totals: any; rows: ValRow[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<ValRow | null>(null);
  const [layers, setLayers] = useState<LayerRow[] | null>(null);
  const [layersLoading, setLayersLoading] = useState(false);
  const [layersError, setLayersError] = useState<string | null>(null);

  const qs = useMemo(() => {
    const sp = new URLSearchParams();
    if (asOf.trim()) sp.set('asOf', asOf.trim());
    if (warehouseId.trim()) sp.set('warehouseId', warehouseId.trim());
    if (productId.trim()) sp.set('productId', productId.trim());
    sp.set('groupBy', view);
    return sp.toString();
  }, [asOf, warehouseId, productId, view]);

  async function load() {
    setError(null);
    setLoading(true);
    setSelected(null);
    setLayers(null);
    setLayersError(null);

    try {
      const res = await fetch(`/api/inv/reports/stock-valuation?${qs}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Failed to load valuation');

      setData({ totals: body.totals, rows: body.rows ?? [] });
    } catch (e: any) {
      setData(null);
      setError(e?.message ?? 'Failed to load valuation');
    } finally {
      setLoading(false);
    }
  }

  async function loadLayers(row: ValRow) {
    setSelected(row);
    setLayers(null);
    setLayersError(null);
    setLayersLoading(true);

    try {
      const sp = new URLSearchParams();
      sp.set('asOf', asOf);
      sp.set('productId', row.productId);

      const wh = row.warehouseId ?? (warehouseId.trim() ? warehouseId.trim() : '');
      if (wh) sp.set('warehouseId', wh);

      const res = await fetch(`/api/inv/reports/stock-valuation/layers?${sp.toString()}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Failed to load FIFO layers');

      setLayers(body.layers ?? []);
    } catch (e: any) {
      setLayersError(e?.message ?? 'Failed to load FIFO layers');
    } finally {
      setLayersLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const colSpan = view === 'product' ? 5 : 6;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Stock Valuation (FIFO)</h1>
        <p className="text-sm text-muted-foreground">
          Professional valuation drill-path: Product totals → Product by warehouse → FIFO layers (audit-grade FX).
        </p>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>As-of date + optional warehouse/product scope.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
          <div className="space-y-2">
            <Label>As-of (YYYY-MM-DD)</Label>
            <Input value={asOf} onChange={(e) => setAsOf(e.target.value)} placeholder="2026-02-09" />
          </div>

          <div className="space-y-2">
            <Label>Warehouse ID (optional)</Label>
            <Input value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} placeholder="warehouseId" />
          </div>

          <div className="space-y-2">
            <Label>Product ID (optional)</Label>
            <Input value={productId} onChange={(e) => setProductId(e.target.value)} placeholder="productId" />
          </div>

          <div className="space-y-2">
            <Label>View</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={view === 'product' ? 'default' : 'outline'}
                onClick={() => setView('product')}
              >
                Product totals
              </Button>
              <Button
                type="button"
                variant={view === 'productWarehouse' ? 'default' : 'outline'}
                onClick={() => setView('productWarehouse')}
              >
                Product → Warehouse
              </Button>
              <Button
                type="button"
                variant={view === 'warehouseProduct' ? 'default' : 'outline'}
                onClick={() => setView('warehouseProduct')}
              >
                Warehouse → Product
              </Button>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={load} disabled={loading}>
              {loading ? 'Loading…' : 'Run'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setWarehouseId('');
                setProductId('');
              }}
            >
              Clear
            </Button>
          </div>

          <div className="md:col-span-5 text-xs text-muted-foreground">
            Query: <code className="text-foreground">{qs}</code>
          </div>
        </CardContent>
      </Card>

      {loading && (
        <Card>
          <CardHeader>
            <CardTitle>Loading</CardTitle>
            <CardDescription>Computing valuation…</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      )}

      {!loading && data && (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <CardDescription>
              Lines: <code>{data.totals?.lines ?? 0}</code> · Total valuation:{' '}
              <code>{data.totals?.valuationBase ?? '0.00'} TRY</code>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                    {view !== 'product' && <th>Warehouse</th>}
                    <th>Product</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Avg cost (TRY)</th>
                    <th className="text-right">Valuation (TRY)</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-t [&>tr]:border-border">
                  {data.rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-muted-foreground" colSpan={colSpan}>
                        No FIFO layers found for this filter/as-of date.
                      </td>
                    </tr>
                  ) : (
                    data.rows.map((r) => (
                      <tr
                        key={
                          view === 'product'
                            ? r.productId
                            : `${r.productId}:${r.warehouseId ?? ''}`
                        }
                        className="[&>td]:px-3 [&>td]:py-2"
                      >
                        {view !== 'product' && (
                          <td className="min-w-[240px]">
                            <div className="font-medium">{r.warehouseCode} — {r.warehouseName}</div>
                            <div className="text-xs text-muted-foreground font-mono">{r.warehouseId}</div>
                          </td>
                        )}

                        <td className="min-w-[320px]">
                          <div className="font-medium">{r.productCode} — {r.productName}</div>
                          <div className="text-xs text-muted-foreground font-mono">{r.productId}</div>
                        </td>

                        <td className="text-right tabular-nums">{Number(r.qtyOnHand).toFixed(4)}</td>
                        <td className="text-right tabular-nums">{Number(r.avgCostBase).toFixed(6)}</td>
                        <td className="text-right tabular-nums">{Number(r.valuationBase).toFixed(2)}</td>

                        <td className="text-right">
                          <Button size="sm" variant="secondary" onClick={() => loadLayers(r)} disabled={layersLoading}>
                            Layers
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {selected && (
              <div className="mt-4">
                <div className="text-sm font-medium">
                  FIFO layers for {selected.productCode} — {selected.productName}
                  {selected.warehouseId ? (
                    <span className="text-muted-foreground">
                      {' '} (warehouse: {selected.warehouseCode || selected.warehouseId})
                    </span>
                  ) : null}
                </div>

                {layersError && (
                  <div className="mt-2">
                    <Alert variant="destructive">{layersError}</Alert>
                  </div>
                )}

                {layersLoading && (
                  <div className="mt-2 space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                )}

                {!layersLoading && layers && (
                  <div className="mt-2 overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                          <th>Warehouse</th>
                          <th>Received</th>
                          <th className="text-right">Qty remain</th>

                          <th>CCY</th>
                          <th className="text-right">Unit (CCY)</th>
                          <th className="text-right">FX → TRY</th>

                          <th className="text-right">Unit (TRY)</th>
                          <th>Source</th>
                        </tr>
                      </thead>
                      <tbody className="[&>tr]:border-t [&>tr]:border-border">
                        {layers.length === 0 ? (
                          <tr>
                            <td className="px-3 py-3 text-muted-foreground" colSpan={8}>
                              No remaining layers for this selection.
                            </td>
                          </tr>
                        ) : (
                          layers.map((l) => (
                            <tr key={l.id} className="[&>td]:px-3 [&>td]:py-2">
                              <td className="font-mono text-xs text-muted-foreground">{l.warehouseId}</td>
                              <td className="font-mono text-xs text-muted-foreground">
                                {String(l.receivedAt).slice(0, 10)}
                              </td>
                              <td className="text-right tabular-nums">{Number(l.qtyRemain).toFixed(4)}</td>

                              <td className="font-mono text-xs">{(l.sourceCurrencyCode ?? '').toString()}</td>
                              <td className="text-right tabular-nums">{fmtMaybe(l.unitCostTxn, 6)}</td>
                              <td className="text-right tabular-nums">{fmtMaybe(l.fxRateToTry, 8)}</td>

                              <td className="text-right tabular-nums">{Number(l.unitCostBase).toFixed(6)}</td>
                              <td className="text-xs font-mono">
                                {l.sourceType}:{l.sourceId}{l.sourceLineId ? `:${l.sourceLineId}` : ''}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

type DeliverLine = {
  soLineId: string;
  quantity: string;
  notes?: string;
};

type OnHandRow = {
  productId: string;
  warehouseId: string;
  onHand: string; // fixed(4)
};

type InvoiceLineDraft = {
  productId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  vatCode: string;
  soLineId: string;
};

function n4(x: any) {
  const v = Number(x ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function clampNonNeg(n: number) {
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export default function SalesOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [so, setSo] = useState<any | null>(null);
  const [deliveredBySoLineId, setDeliveredBySoLineId] = useState<Record<string, string>>({});
  const [onHandByProductId, setOnHandByProductId] = useState<Record<string, number>>({});

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'deliver' | 'invoice' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [approveReason, setApproveReason] = useState('Approved in ERP');
  const [deliverNotes, setDeliverNotes] = useState('Delivered from ERP');
  const [deliverLines, setDeliverLines] = useState<DeliverLine[]>([]);

  const [invoiceLines, setInvoiceLines] = useState<InvoiceLineDraft[]>([]);
  const [invoiceNotes, setInvoiceNotes] = useState('');

  async function load() {
    setError(null);
    setOk(null);
    setLoading(true);

    try {
      const [soRes, sumRes] = await Promise.all([
        fetch(`/api/sales/orders/${encodeURIComponent(id)}`),
        fetch(`/api/sales/orders/${encodeURIComponent(id)}/delivery-summary`),
      ]);

      const soBody = await soRes.json().catch(() => null);
      if (!soRes.ok) throw new Error(soBody?.message ?? 'Failed to load sales order');

      const sumBody = await sumRes.json().catch(() => null);
      if (!sumRes.ok) throw new Error(sumBody?.message ?? 'Failed to load delivery summary');

      const deliveredMap: Record<string, string> = sumBody?.deliveredBySoLineId ?? {};
      setSo(soBody);
      setDeliveredBySoLineId(deliveredMap);

      // On-hand
      const warehouseId = String(soBody?.warehouseId ?? '').trim();
      const products: string[] = Array.isArray(soBody?.lines)
        ? soBody.lines
            .map((l: any) => l?.productId)
            .filter((x: any): x is string => typeof x === 'string' && x.length > 0)
        : [];

      const uniqProducts: string[] = Array.from(new Set(products));
      const onHandMap: Record<string, number> = {};

      if (warehouseId && uniqProducts.length > 0) {
        const results: Array<{ pid: string; onHand: number }> = await Promise.all(
          uniqProducts.map(async (pid) => {
            const r = await fetch(
              `/api/inv/onhand?warehouseId=${encodeURIComponent(warehouseId)}&productId=${encodeURIComponent(pid)}`,
            );
            const b = await r.json().catch(() => null);
            if (!r.ok) return { pid, onHand: 0 };
            const row: OnHandRow | undefined = Array.isArray(b) ? b[0] : undefined;
            return { pid, onHand: n4(row?.onHand ?? 0) };
          }),
        );

        for (const x of results) onHandMap[x.pid] = x.onHand;
      }
      setOnHandByProductId(onHandMap);

      // default deliver lines = min(remaining, onhand)
      const lines: any[] = Array.isArray(soBody?.lines) ? soBody.lines : [];
      setDeliverLines(
        lines.map((l) => {
          const ordered = n4(l.quantity);
          const delivered = n4(deliveredMap?.[l.id]);
          const remaining = clampNonNeg(ordered - delivered);

          const onHand = onHandMap[String(l.productId)] ?? 0;
          const suggest = Math.min(remaining, onHand);

          return {
            soLineId: l.id,
            quantity: suggest.toFixed(4).replace(/\.?0+$/, ''),
            notes: l.notes ?? undefined,
          };
        }),
      );

      // default invoice lines = full SO lines
      setInvoiceLines(
        lines.map((l) => {
          const deliveredQty = n4(deliveredMap?.[l.id]); // delivery-summary is keyed by soLineId
          return {
            productId: l.productId ?? null,
            description: `SO ${soBody.documentNo} - ${l.productId}`,
            quantity: deliveredQty.toFixed(4).replace(/\.?0+$/, ''),
            unitPrice: String(l.unitPrice ?? '0'),
            vatCode: String(l.vatCode ?? 'KDV_20'),
            soLineId: l.soLineId,
          };
        }),
      );
    } catch (e: any) {
      setSo(null);
      setDeliveredBySoLineId({});
      setOnHandByProductId({});
      setInvoiceLines([]);
      setError(e?.message ?? 'Failed to load sales order');
    } finally {
      setLoading(false);
    }
  }

  async function approve() {
    setError(null);
    setOk(null);
    setBusy('approve');
    try {
      const res = await fetch(`/api/sales/orders/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: approveReason }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Approve failed');
      setOk('Order approved.');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Approve failed');
    } finally {
      setBusy(null);
    }
  }

  function updateDeliverLine(idx: number, patch: Partial<DeliverLine>) {
    setDeliverLines((prev) => prev.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }

  const deliverPayload = useMemo(() => {
    return {
      notes: deliverNotes,
      lines: deliverLines
        .map((l) => ({
          soLineId: String(l.soLineId),
          quantity: String(l.quantity ?? '').trim(),
          notes: l.notes ? String(l.notes) : undefined,
        }))
        .filter((l) => l.soLineId && Number(l.quantity) > 0),
    };
  }, [deliverLines, deliverNotes]);

  async function deliver() {
    setError(null);
    setOk(null);

    if (!Array.isArray(deliverPayload.lines) || deliverPayload.lines.length === 0) {
      setError('Nothing to deliver: all suggested quantities are 0 (no remaining or no stock).');
      return;
    }

    setBusy('deliver');
    try {
      const res = await fetch(`/api/sales/orders/${encodeURIComponent(id)}/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deliverPayload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Deliver failed');

      const deliveryId = body?.deliveryId ?? body?.id ?? body?.salesDeliveryId ?? null;

      if (deliveryId) {
        setOk(`Delivered. Opening delivery ${deliveryId}…`);
        router.push(`/sales/deliveries/${deliveryId}`);
        router.refresh();
        return;
      }

      setOk('Delivered. Open deliveries list and select the latest delivery.');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Deliver failed');
    } finally {
      setBusy(null);
    }
  }

  function updateInvoiceLine(idx: number, patch: Partial<InvoiceLineDraft>) {
    setInvoiceLines((prev) => prev.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }

  async function createInvoice() {
    setError(null);
    setOk(null);

    if (!so) {
      setError('Sales order not loaded.');
      return;
    }

    const lines = invoiceLines
      .map((l) => ({
        productId: l.productId,
        description: l.description,
        quantity: String(l.quantity ?? '').trim(),
        unitPrice: String(l.unitPrice ?? '').trim(),
        vatCode: String(l.vatCode ?? '').trim(),
      }))
      .filter((l) => Number(l.quantity) > 0);

    if (lines.length === 0) {
      setError('Invoice must have at least one line with quantity > 0.');
      return;
    }

    setBusy('invoice');
    try {
      const res = await fetch('/api/sales/invoices/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: so.customerId,
          soId: so.id,
          currencyCode: so.currencyCode,
          exchangeRateToBase: so.exchangeRateToBase ?? null,
          notes: invoiceNotes || undefined,
          lines,
        }),
      });

      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Failed to create invoice');

      const invoiceId = body?.id ?? null;
      const docNo = body?.documentNo ?? '';
      setOk(`Invoice created ${docNo}. Opening…`);

      if (invoiceId) {
        router.push(`/sales/invoices/${invoiceId}`);
        router.refresh();
        return;
      }

      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create invoice');
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Sales Order</h1>
          <p className="text-sm text-muted-foreground">Approve → Deliver → Invoice</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading || busy !== null}>
            Refresh
          </Button>
          <Link className="self-center text-sm underline underline-offset-4" href="/sales/deliveries">
            Deliveries
          </Link>
        </div>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}
      {ok && <Alert>{ok}</Alert>}

      {loading && (
        <Card>
          <CardHeader>
            <CardTitle>Loading</CardTitle>
            <CardDescription>Fetching sales order…</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      )}

      {!loading && so && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Header</CardTitle>
              <CardDescription>Order metadata.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <span className="text-muted-foreground">Document No:</span>{' '}
                <span className="font-mono">{so.documentNo}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Status:</span>{' '}
                <span className="font-mono">{so.status}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Customer:</span>{' '}
                <span>{so.customer?.name ?? so.customerId}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Warehouse:</span>{' '}
                <span>{so.warehouse?.code ? `${so.warehouse.code} — ${so.warehouse.name}` : so.warehouseId}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lines (remaining & stock-aware)</CardTitle>
              <CardDescription>Defaults Deliver-now to min(remaining, on-hand).</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                      <th>SO Line</th>
                      <th>Product</th>
                      <th className="text-right">Ordered</th>
                      <th className="text-right">Delivered</th>
                      <th className="text-right">Remaining</th>
                      <th className="text-right">On hand</th>
                      <th className="text-right">Deliver now</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="[&>tr]:border-t [&>tr]:border-border">
                    {(so.lines ?? []).map((l: any, idx: number) => {
                      const ordered = n4(l.quantity);
                      const delivered = n4(deliveredBySoLineId?.[l.id]);
                      const remaining = clampNonNeg(ordered - delivered);

                      const onHand = onHandByProductId[String(l.productId)] ?? 0;
                      const deliverNow = n4(deliverLines[idx]?.quantity);

                      const insufficient = remaining > 1e-9 && onHand + 1e-9 < remaining;

                      return (
                        <tr key={l.id} className="[&>td]:px-3 [&>td]:py-2">
                          <td className="font-mono text-xs">{l.id}</td>
                          <td className="font-mono text-xs">{l.productId}</td>
                          <td className="text-right tabular-nums">{ordered.toFixed(4)}</td>
                          <td className="text-right tabular-nums">{delivered.toFixed(4)}</td>
                          <td className="text-right tabular-nums">{remaining.toFixed(4)}</td>
                          <td className="text-right tabular-nums">{onHand.toFixed(4)}</td>
                          <td className="text-right">
                            <Input
                              className="w-[140px] ml-auto text-right"
                              value={deliverLines[idx]?.quantity ?? '0'}
                              onChange={(e) => updateDeliverLine(idx, { quantity: e.target.value })}
                              disabled={remaining <= 1e-9 || onHand <= 1e-9}
                            />
                          </td>
                          <td className="text-right text-xs">
                            {insufficient ? <span className="text-destructive">Insufficient</span> : null}
                            {remaining <= 1e-9 ? <span className="text-muted-foreground">Done</span> : null}
                            {deliverNow > onHand + 1e-9 ? <span className="text-destructive">Too high</span> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 text-xs text-muted-foreground">
                On-hand is from StockLedger (not “available-to-promise”). FIFO may still fail if layers are missing even
                though on-hand is positive, but this eliminates most user errors.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
              <CardDescription>Operational steps with audit reasons.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              <div className="space-y-2">
                <Label>Approve reason</Label>
                <Input value={approveReason} onChange={(e) => setApproveReason(e.target.value)} />
                <Button onClick={approve} disabled={busy !== null}>
                  {busy === 'approve' ? 'Approving…' : 'Approve'}
                </Button>
              </div>

              <div className="space-y-2">
                <Label>Delivery notes</Label>
                <Input value={deliverNotes} onChange={(e) => setDeliverNotes(e.target.value)} />
                <Button onClick={deliver} disabled={busy !== null}>
                  {busy === 'deliver' ? 'Delivering…' : 'Deliver'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* NEW: Create Invoice */}
          <Card>
            <CardHeader>
              <CardTitle>Create Invoice</CardTitle>
              <CardDescription>Create a draft customer invoice from this Sales Order.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label>Invoice notes (optional)</Label>
                <Input value={invoiceNotes} onChange={(e) => setInvoiceNotes(e.target.value)} />
              </div>

              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                      <th>Product</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Unit price</th>
                      <th>VAT</th>
                    </tr>
                  </thead>
                  <tbody className="[&>tr]:border-t [&>tr]:border-border">
                    {invoiceLines.map((l, idx) => (
                      <tr key={`${l.productId ?? 'none'}:${idx}`} className="[&>td]:px-3 [&>td]:py-2">
                        <td className="font-mono text-xs">{l.productId ?? ''}</td>
                        <td className="text-right">
                          <Input
                            className="w-[140px] ml-auto text-right"
                            value={l.quantity}
                            onChange={(e) => updateInvoiceLine(idx, { quantity: e.target.value })}
                          />
                        </td>
                        <td className="text-right">
                          <Input
                            className="w-[160px] ml-auto text-right"
                            value={l.unitPrice}
                            onChange={(e) => updateInvoiceLine(idx, { unitPrice: e.target.value })}
                          />
                        </td>
                        <td>
                          <Input
                            className="w-[120px]"
                            value={l.vatCode}
                            onChange={(e) => updateInvoiceLine(idx, { vatCode: e.target.value })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Button onClick={createInvoice} disabled={busy !== null}>
                {busy === 'invoice' ? 'Creating…' : 'Create Draft Invoice'}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
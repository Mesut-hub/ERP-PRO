'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Line = {
  productId: string;
  unitId: string;
  quantity: string;
  unitCostTxn: string;
  notes?: string;
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function n(x: any) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

function fmt6(x: number) {
  return (Math.round((x + Number.EPSILON) * 1_000_000) / 1_000_000).toFixed(6);
}

function fmt8(x: number) {
  return (Math.round((x + Number.EPSILON) * 100_000_000) / 100_000_000).toFixed(8);
}

export default function NewReceiptMovePage() {
  const router = useRouter();

  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);

  const [toWarehouseId, setToWarehouseId] = useState('');
  const [documentDate, setDocumentDate] = useState(todayStr());
  const [notes, setNotes] = useState('Receipt into stock');

  // ✅ Header-level FX context
  const [sourceCurrencyCode, setSourceCurrencyCode] = useState('USD');
  const [fxRateToTry, setFxRateToTry] = useState('32.00000000');

  const [lines, setLines] = useState<Line[]>([
    { productId: '', unitId: '', quantity: '1', unitCostTxn: '1.000000', notes: '' },
  ]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMasters() {
    const [wRes, pRes, uRes, cRes] = await Promise.all([
      fetch('/api/inv/warehouses'),
      fetch('/api/md/products'),
      fetch('/api/md/units'),
      fetch('/api/md/currencies'),
    ]);

    const w = await wRes.json().catch(() => []);
    const p = await pRes.json().catch(() => []);
    const u = await uRes.json().catch(() => []);
    const c = await cRes.json().catch(() => []);

    if (!wRes.ok) throw new Error(w?.message ?? 'Failed to load warehouses');
    if (!pRes.ok) throw new Error(p?.message ?? 'Failed to load products');
    if (!uRes.ok) throw new Error(u?.message ?? 'Failed to load units');
    if (!cRes.ok) throw new Error(c?.message ?? 'Failed to load currencies');

    setWarehouses(Array.isArray(w) ? w : []);
    setProducts(Array.isArray(p) ? p : []);
    setUnits(Array.isArray(u) ? u : []);
    setCurrencies(Array.isArray(c) ? c : []);

    const main = (Array.isArray(w) ? w : []).find((x: any) => String(x.code).toUpperCase() === 'MAIN');
    const def = main?.id ?? (Array.isArray(w) && w.length > 0 ? w[0].id : '');
    setToWarehouseId((prev) => prev || def);

    // default currency: USD if active else first
    const usd = (Array.isArray(c) ? c : []).find((x: any) => String(x.code).toUpperCase() === 'USD');
    const defCcy = usd?.code ?? (Array.isArray(c) && c.length > 0 ? c[0].code : 'USD');
    setSourceCurrencyCode((prev) => prev || defCcy);
  }

  useEffect(() => {
    setError(null);
    loadMasters().catch((e: any) => setError(e?.message ?? 'Failed to load master data'));
  }, []);

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      { productId: '', unitId: '', quantity: '1', unitCostTxn: '1.000000', notes: '' },
    ]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  const payload = useMemo(() => {
    const fx = n(fxRateToTry);

    return {
      type: 'RECEIPT',
      toWarehouseId,
      documentDate,
      notes,
      lines: lines
        .map((l) => {
          const qty = String(l.quantity ?? '').trim();
          const unitTxn = String(l.unitCostTxn ?? '').trim();
          const base = n(unitTxn) * fx;

          return {
            productId: String(l.productId ?? '').trim(),
            unitId: String(l.unitId ?? '').trim(),
            quantity: qty,
            notes: l.notes ? String(l.notes) : undefined,

            sourceCurrencyCode: String(sourceCurrencyCode ?? '').trim() || null,
            unitCostTxn: unitTxn,
            fxRateToTry: fmt8(fx),
            unitCostBase: fmt6(base),
          };
        })
        .filter((l) => l.productId && l.unitId && Number(l.quantity) > 0),
    };
  }, [toWarehouseId, documentDate, notes, lines, sourceCurrencyCode, fxRateToTry]);

  async function create() {
    setError(null);

    if (!payload.toWarehouseId) {
      setError('Please select a destination warehouse.');
      return;
    }
    if (!payload.documentDate) {
      setError('Please select document date.');
      return;
    }
    if (!sourceCurrencyCode || sourceCurrencyCode.length !== 3) {
      setError('Select a 3-letter source currency (e.g. USD).');
      return;
    }
    if (!(n(fxRateToTry) > 0)) {
      setError('FX rate must be > 0.');
      return;
    }
    if (payload.lines.length === 0) {
      setError('Add at least one valid line (product, unit, quantity > 0).');
      return;
    }

    // ensure costs exist
    const bad = payload.lines.find((l) => !(Number(l.unitCostBase) > 0));
    if (bad) {
      setError('Each receipt line must have unit cost > 0 (unitCostBase computed).');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/inv/moves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Failed to create receipt');

      router.push(`/inventory/moves/${body.id}`);
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create receipt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">New Stock Receipt</h1>

      {error && <Alert variant="destructive">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Header</CardTitle>
          <CardDescription>Create a DRAFT receipt move, then post it (valued receipt).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>To warehouse</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={toWarehouseId}
                onChange={(e) => setToWarehouseId(e.target.value)}
              >
                <option value="">Select…</option>
                {warehouses.map((w: any) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Document date</Label>
              <Input type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Currency</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={sourceCurrencyCode}
                onChange={(e) => setSourceCurrencyCode(e.target.value)}
              >
                {currencies.map((c: any) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>FX rate → TRY</Label>
              <Input value={fxRateToTry} onChange={(e) => setFxRateToTry(e.target.value)} />
              <div className="text-xs text-muted-foreground">
                Used to compute base cost: <code>unitCostBase = unitCostTxn × fxRate</code>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
          <CardDescription>Add products to receive into stock (valued FIFO layers will be created).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.map((l, idx) => {
            const base = n(l.unitCostTxn) * n(fxRateToTry);

            return (
              <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                <div className="md:col-span-4 space-y-1">
                  <Label>Product</Label>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={l.productId}
                    onChange={(e) => updateLine(idx, { productId: e.target.value })}
                  >
                    <option value="">Select…</option>
                    {products.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2 space-y-1">
                  <Label>Unit</Label>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={l.unitId}
                    onChange={(e) => updateLine(idx, { unitId: e.target.value })}
                  >
                    <option value="">Select…</option>
                    {units.map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.code ?? u.name ?? u.id}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-1 space-y-1">
                  <Label>Qty</Label>
                  <Input value={l.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
                </div>

                <div className="md:col-span-2 space-y-1">
                  <Label>Unit cost ({sourceCurrencyCode})</Label>
                  <Input
                    value={l.unitCostTxn}
                    onChange={(e) => updateLine(idx, { unitCostTxn: e.target.value })}
                  />
                </div>

                <div className="md:col-span-2 space-y-1">
                  <Label>Unit cost (TRY)</Label>
                  <Input value={fmt6(base)} readOnly />
                </div>

                <div className="md:col-span-1">
                  <Button variant="outline" onClick={() => removeLine(idx)} disabled={lines.length <= 1}>
                    Del
                  </Button>
                </div>
              </div>
            );
          })}

          <div className="flex gap-2">
            <Button variant="outline" onClick={addLine}>
              Add line
            </Button>
            <Button onClick={create} disabled={busy}>
              {busy ? 'Creating…' : 'Create Draft Receipt'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
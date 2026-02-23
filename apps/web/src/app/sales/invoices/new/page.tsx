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
  description: string;
  quantity: string;
  unitPrice: string;
  vatCode: string;
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function NewSalesInvoicePage() {
  const router = useRouter();

  const [customers, setCustomers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [vatRates, setVatRates] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);

  const [customerId, setCustomerId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('TRY');
  const [documentDate, setDocumentDate] = useState(todayStr());
  const [notes, setNotes] = useState('');

  const [lines, setLines] = useState<Line[]>([
    { productId: '', description: '', quantity: '1', unitPrice: '0', vatCode: 'KDV_20' },
  ]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMasters() {
    const [cRes, pRes, vRes, curRes] = await Promise.all([
      fetch('/api/md/parties?type=CUSTOMER'),
      fetch('/api/md/products'),
      fetch('/api/md/vat/rates'),
      fetch('/api/md/currencies'),
    ]);

    const c = await cRes.json().catch(() => []);
    const p = await pRes.json().catch(() => []);
    const v = await vRes.json().catch(() => []);
    const cur = await curRes.json().catch(() => []);

    if (!cRes.ok) throw new Error(c?.message ?? 'Failed to load customers');
    if (!pRes.ok) throw new Error(p?.message ?? 'Failed to load products');
    if (!vRes.ok) throw new Error(v?.message ?? 'Failed to load VAT rates');
    if (!curRes.ok) throw new Error(cur?.message ?? 'Failed to load currencies');

    setCustomers(Array.isArray(c) ? c : []);
    setProducts(Array.isArray(p) ? p : []);
    setVatRates(Array.isArray(v) ? v : []);
    setCurrencies(Array.isArray(cur) ? cur : []);

    // defaults
    const defCustomer = (Array.isArray(c) && c.length > 0 ? c[0].id : '');
    setCustomerId((prev) => prev || defCustomer);

    const tryCur = (Array.isArray(cur) ? cur : []).find((x: any) => String(x.code).toUpperCase() === 'TRY');
    const defCur = tryCur?.code ?? (Array.isArray(cur) && cur.length > 0 ? cur[0].code : 'TRY');
    setCurrencyCode((prev) => prev || defCur);
  }

  useEffect(() => {
    setError(null);
    loadMasters().catch((e: any) => setError(e?.message ?? 'Failed to load master data'));
  }, []);

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, { productId: '', description: '', quantity: '1', unitPrice: '0', vatCode: 'KDV_20' }]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  const payload = useMemo(() => {
    return {
      customerId,
      currencyCode,
      documentDate,
      notes: notes || undefined,
      lines: lines
        .map((l) => ({
          productId: String(l.productId ?? '').trim() || null,
          description: String(l.description ?? '').trim() || 'Invoice line',
          quantity: String(l.quantity ?? '').trim(),
          unitPrice: String(l.unitPrice ?? '').trim(),
          vatCode: String(l.vatCode ?? '').trim(),
        }))
        .filter((l) => Number(l.quantity) > 0),
    };
  }, [customerId, currencyCode, documentDate, notes, lines]);

  async function create() {
    setError(null);

    if (!payload.customerId) {
      setError('Please select a customer.');
      return;
    }
    if (!payload.currencyCode) {
      setError('Please select currency.');
      return;
    }
    if (payload.lines.length === 0) {
      setError('Invoice must have at least one line with quantity > 0.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/sales/invoices/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Failed to create invoice');

      router.push(`/sales/invoices/${body.id}`);
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create invoice');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">New Customer Invoice</h1>

      {error && <Alert variant="destructive">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Header</CardTitle>
          <CardDescription>Create a draft invoice without a Sales Order.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Customer</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">Select…</option>
                {customers.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.code ?? c.name ?? c.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Currency</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={currencyCode}
                onChange={(e) => setCurrencyCode(e.target.value)}
              >
                {currencies.map((c: any) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Document date</Label>
              <Input type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
          <CardDescription>Line-level details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.map((l, idx) => (
            <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
              <div className="md:col-span-4 space-y-1">
                <Label>Product</Label>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={l.productId}
                  onChange={(e) => updateLine(idx, { productId: e.target.value })}
                >
                  <option value="">(Optional) Select…</option>
                  {products.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-3 space-y-1">
                <Label>Description</Label>
                <Input value={l.description} onChange={(e) => updateLine(idx, { description: e.target.value })} />
              </div>

              <div className="md:col-span-1 space-y-1">
                <Label>Qty</Label>
                <Input value={l.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
              </div>

              <div className="md:col-span-2 space-y-1">
                <Label>Unit price</Label>
                <Input value={l.unitPrice} onChange={(e) => updateLine(idx, { unitPrice: e.target.value })} />
              </div>

              <div className="md:col-span-1 space-y-1">
                <Label>VAT</Label>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={l.vatCode}
                  onChange={(e) => updateLine(idx, { vatCode: e.target.value })}
                >
                  {vatRates.map((v: any) => (
                    <option key={v.code} value={v.code}>
                      {v.code} ({v.percent}%)
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-1">
                <Button variant="outline" onClick={() => removeLine(idx)} disabled={lines.length <= 1}>
                  Del
                </Button>
              </div>
            </div>
          ))}

          <div className="flex gap-2">
            <Button variant="outline" onClick={addLine}>
              Add line
            </Button>
            <Button onClick={create} disabled={busy}>
              {busy ? 'Creating…' : 'Create Draft Invoice'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
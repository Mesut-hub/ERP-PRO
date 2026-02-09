'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

type ExchangeRateRow = {
  id: string;
  fromCode: string;
  toCode: string;
  rate: string;
  rateDate: string; // ISO
  source: string | null;
  createdAt: string; // ISO
};

function ymdToday() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso?.slice(0, 10) ?? '';
  }
}

export default function ExchangeRatesPage() {
  // Filters
  const [rateDate, setRateDate] = useState<string>(ymdToday());
  const [fromCode, setFromCode] = useState<string>(''); // empty => all
  const [toCode, setToCode] = useState<string>('TRY');
  const [source, setSource] = useState<string>(''); // empty => all

  // Manual upsert form
  const [manualFrom, setManualFrom] = useState('USD');
  const [manualTo, setManualTo] = useState('TRY');
  const [manualDate, setManualDate] = useState<string>(ymdToday());
  const [manualRate, setManualRate] = useState<string>(''); // string for precision

  const [rows, setRows] = useState<ExchangeRateRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const listUrl = useMemo(() => {
    const sp = new URLSearchParams();
    if (fromCode.trim()) sp.set('from', fromCode.trim().toUpperCase());
    if (toCode.trim()) sp.set('to', toCode.trim().toUpperCase());
    if (source.trim()) sp.set('source', source.trim());
    if (rateDate.trim()) sp.set('rateDate', rateDate.trim());
    return `/api/md/exchange-rates?${sp.toString()}`;
  }, [fromCode, toCode, source, rateDate]);

  async function load() {
    setError(null);
    setOkMsg(null);
    setLoading(true);
    try {
      const res = await fetch(listUrl);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Failed to load exchange rates');

      const all: ExchangeRateRow[] = Array.isArray(body) ? body : (body?.data ?? []);
      all.sort((a, b) => a.fromCode.localeCompare(b.fromCode));
      setRows(all);
    } catch (e: any) {
      setRows(null);
      setError(e?.message ?? 'Failed to load exchange rates');
    } finally {
      setLoading(false);
    }
  }

  async function syncCbrt() {
    setError(null);
    setOkMsg(null);
    setSyncing(true);
    try {
      const url = `/api/md/exchange-rates/cbrt/sync?date=${encodeURIComponent(rateDate)}`;
      const res = await fetch(url, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'CBRT sync failed');

      setOkMsg(`CBRT sync OK: upserted ${body?.upserted ?? '?'} rates for ${body?.rateDate ?? rateDate}`);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'CBRT sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function saveManual() {
    setError(null);
    setOkMsg(null);

    const payload = {
      fromCode: manualFrom.trim().toUpperCase(),
      toCode: manualTo.trim().toUpperCase(),
      rate: String(manualRate).trim(),
      rateDate: manualDate,
    };

    if (!payload.fromCode || payload.fromCode.length !== 3) {
      setError('Manual upsert: fromCode must be 3 letters');
      return;
    }
    if (!payload.toCode || payload.toCode.length !== 3) {
      setError('Manual upsert: toCode must be 3 letters');
      return;
    }
    if (!payload.rate) {
      setError('Manual upsert: rate is required');
      return;
    }
    if (!payload.rateDate) {
      setError('Manual upsert: rateDate is required');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/md/exchange-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Manual upsert failed');

      setOkMsg(`Saved ${payload.fromCode}->${payload.toCode} for ${payload.rateDate}.`);
      // keep filters aligned with manual save
      setRateDate(payload.rateDate);
      setToCode(payload.toCode);
      setFromCode(payload.fromCode);
      setTimeout(() => load(), 0);
    } catch (e: any) {
      setError(e?.message ?? 'Manual upsert failed');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Exchange Rates</h1>
        <p className="text-sm text-muted-foreground">
          Manage daily rates and sync official CBRT Forex Selling values.
        </p>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}
      {okMsg && <Alert>{okMsg}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>CBRT Sync</CardTitle>
          <CardDescription>
            Pull official CBRT Forex Selling rates and store as CCY → TRY for the selected day (Istanbul).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div className="space-y-2">
            <Label>Rate date (YYYY-MM-DD)</Label>
            <Input value={rateDate} onChange={(e) => setRateDate(e.target.value)} placeholder="2026-02-09" />
          </div>

          <div className="space-y-2">
            <Label>To currency</Label>
            <Input value={toCode} onChange={(e) => setToCode(e.target.value)} placeholder="TRY" />
          </div>

          <div className="space-y-2">
            <Label>Source (optional)</Label>
            <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="CBRT / manual / seed" />
          </div>

          <div className="flex gap-2">
            <Button onClick={syncCbrt} disabled={syncing || loading || !rateDate}>
              {syncing ? 'Syncing…' : 'Sync from CBRT'}
            </Button>
            <Button variant="outline" onClick={load} disabled={loading}>
              Refresh
            </Button>
          </div>

          <div className="md:col-span-4 flex flex-wrap gap-2">
            <div className="text-xs text-muted-foreground self-center">Quick filters:</div>
            {['', 'USD', 'EUR', 'GBP'].map((c) => (
              <Button
                key={c || 'ALL'}
                size="sm"
                variant="secondary"
                onClick={() => setFromCode(c)}
                disabled={loading}
              >
                {c ? c : 'ALL'}
              </Button>
            ))}
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              Apply filters
            </Button>
            <div className="ml-auto text-xs text-muted-foreground self-center">
              Endpoint: <code className="text-foreground">{listUrl}</code>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Manual Upsert</CardTitle>
          <CardDescription>Add or update a daily rate (idempotent per from/to/date).</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
          <div className="space-y-2">
            <Label>From</Label>
            <Input value={manualFrom} onChange={(e) => setManualFrom(e.target.value)} placeholder="USD" />
          </div>
          <div className="space-y-2">
            <Label>To</Label>
            <Input value={manualTo} onChange={(e) => setManualTo(e.target.value)} placeholder="TRY" />
          </div>
          <div className="space-y-2">
            <Label>Date</Label>
            <Input value={manualDate} onChange={(e) => setManualDate(e.target.value)} placeholder="2026-02-09" />
          </div>
          <div className="space-y-2">
            <Label>Rate</Label>
            <Input value={manualRate} onChange={(e) => setManualRate(e.target.value)} placeholder="43.59660000" />
          </div>
          <div className="flex gap-2">
            <Button onClick={saveManual} disabled={saving}>
              {saving ? 'Saving…' : 'Save rate'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setManualFrom('EUR');
                setManualTo('TRY');
                setManualDate(rateDate);
              }}
              disabled={saving}
            >
              Set EUR→TRY
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rates</CardTitle>
          <CardDescription>
            {fromCode.trim()
              ? `Filtered: ${fromCode.toUpperCase()} → ${toCode.toUpperCase()}`
              : `Filtered: ALL → ${toCode.toUpperCase()}`}{' '}
            for <span className="font-mono">{rateDate}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {!loading && rows && (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                    <th>Date</th>
                    <th>Pair</th>
                    <th className="text-right">Rate</th>
                    <th>Source</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-t [&>tr]:border-border">
                  {rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-muted-foreground" colSpan={5}>
                        No rows found. Try syncing CBRT or change filters.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr key={r.id} className="[&>td]:px-3 [&>td]:py-2">
                        <td className="font-mono text-xs text-muted-foreground">{fmtDate(r.rateDate)}</td>
                        <td className="font-mono text-xs">{r.fromCode}→{r.toCode}</td>
                        <td className="text-right tabular-nums">{Number(r.rate).toFixed(8)}</td>
                        <td className="text-xs">{r.source ?? ''}</td>
                        <td className="text-xs text-muted-foreground">{new Date(r.createdAt).toISOString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
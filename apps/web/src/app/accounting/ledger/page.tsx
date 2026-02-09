'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

type LedgerMeta = { skip: number; take: number; total: number };

function buildQuery(params: Record<string, string | number | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    const s = String(v).trim();
    if (!s) continue;
    sp.set(k, s);
  }
  return sp.toString();
}

function toInt(v: string | null, def: number) {
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

export default function LedgerPage() {
  const searchParams = useSearchParams();
  const initializedFromUrl = useRef(false);

  const [accountCode, setAccountCode] = useState('328');
  const [sourceType, setSourceType] = useState('');
  const [partyId, setPartyId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [take, setTake] = useState(200);
  const [skip, setSkip] = useState(0);

  const [data, setData] = useState<any | null>(null);
  const [meta, setMeta] = useState<LedgerMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // init from URL once
  useEffect(() => {
    if (initializedFromUrl.current) return;

    const qAccountCode = searchParams.get('accountCode');
    const qSourceType = searchParams.get('sourceType');
    const qPartyId = searchParams.get('partyId');
    const qFrom = searchParams.get('from');
    const qTo = searchParams.get('to');
    const qTake = searchParams.get('take');
    const qSkip = searchParams.get('skip');

    if (qAccountCode) setAccountCode(qAccountCode);
    if (qSourceType) setSourceType(qSourceType);
    if (qPartyId) setPartyId(qPartyId);
    if (qFrom) setFrom(qFrom);
    if (qTo) setTo(qTo);

    if (qTake) setTake(Math.min(1000, Math.max(1, toInt(qTake, 200))));
    if (qSkip) setSkip(Math.max(0, toInt(qSkip, 0)));

    initializedFromUrl.current = true;
  }, [searchParams]);

  const queryString = useMemo(
    () =>
      buildQuery({
        accountCode,
        sourceType: sourceType || undefined,
        partyId: partyId || undefined,
        from: from || undefined,
        to: to || undefined,
        take,
        skip,
      }),
    [accountCode, sourceType, partyId, from, to, take, skip],
  );

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/acc/reports/ledger?${queryString}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Failed to load ledger');

      setData(body);
      setMeta(body.meta ?? null);
    } catch (e: any) {
      setData(null);
      setMeta(null);
      setError(e?.message ?? 'Failed to load ledger');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!initializedFromUrl.current) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initializedFromUrl.current]);

  function onApplyFilters() {
    setSkip(0);
    setTimeout(() => load(), 0);
  }

  function canPrev() {
    return (meta?.skip ?? skip) > 0;
  }
  function canNext() {
    if (!meta) return false;
    return meta.skip + meta.take < meta.total;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Ledger</h1>
          <p className="text-sm text-muted-foreground">
            Audit-grade account ledger with deep links and filters.
          </p>
        </div>

        <div className="hidden md:flex items-center gap-2 text-sm">
          <Link className="text-muted-foreground hover:text-foreground" href="/">
            Home
          </Link>
          <span className="text-muted-foreground">/</span>
          <Link className="text-muted-foreground hover:text-foreground" href="/accounting/trial-balance">
            Trial Balance
          </Link>
          <span className="text-muted-foreground">/</span>
          <Link className="text-muted-foreground hover:text-foreground" href="/accounting/grni">
            GRNI
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Apply filters, then review drilldowns per source document.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Account code</Label>
              <Input value={accountCode} onChange={(e) => setAccountCode(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Source type (optional)</Label>
              <Input
                placeholder="PurchaseReturn / SupplierInvoice / ..."
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Party ID (optional)</Label>
              <Input
                placeholder="partyId"
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>From (YYYY-MM-DD)</Label>
              <Input placeholder="2026-01-01" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>To (YYYY-MM-DD)</Label>
              <Input placeholder="2026-12-31" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Page size</Label>
              <Input
                type="number"
                min={1}
                max={1000}
                value={take}
                onChange={(e) => setTake(Math.min(1000, Math.max(1, Number(e.target.value) || 200)))}
              />
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex items-center gap-2">
              <Button onClick={onApplyFilters} disabled={loading}>
                Apply
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setAccountCode('328');
                  setSourceType('');
                  setPartyId('');
                  setFrom('');
                  setTo('');
                  setTake(200);
                  setSkip(0);
                  setTimeout(() => load(), 0);
                }}
                disabled={loading}
              >
                Reset
              </Button>
            </div>

            <div className="md:ml-auto flex flex-wrap items-center gap-2">
              <div className="text-xs text-muted-foreground">Quick accounts</div>
              {['150', '320', '327', '328', '191', '770'].map((c) => (
                <Button
                  key={c}
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setAccountCode(c);
                    setSkip(0);
                    setTimeout(() => load(), 0);
                  }}
                  disabled={loading}
                >
                  {c}
                </Button>
              ))}
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            Query: <code className="text-foreground">{queryString}</code>
          </div>
        </CardContent>
      </Card>

      {error && <Alert variant="destructive">{error}</Alert>}

      {(loading || (!data && !error)) && (
        <Card>
          <CardHeader>
            <CardTitle>Loading</CardTitle>
            <CardDescription>Fetching ledger lines…</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      )}

      {data && (
        <Card>
          <CardHeader>
            <CardTitle>
              {data.account.code} — {data.account.name}
            </CardTitle>
            <CardDescription>Showing the latest entries matching your filters.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {meta && (
              <div className="flex flex-col md:flex-row md:items-center gap-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canPrev() || loading}
                    onClick={() => {
                      const nextSkip = Math.max(0, meta.skip - meta.take);
                      setSkip(nextSkip);
                      setTimeout(() => load(), 0);
                    }}
                  >
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canNext() || loading}
                    onClick={() => {
                      const nextSkip = meta.skip + meta.take;
                      setSkip(nextSkip);
                      setTimeout(() => load(), 0);
                    }}
                  >
                    Next
                  </Button>
                </div>

                <div className="md:ml-auto text-xs text-muted-foreground">
                  Showing {meta.total === 0 ? 0 : meta.skip + 1}-
                  {Math.min(meta.skip + meta.take, meta.total)} of {meta.total}
                </div>
              </div>
            )}

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                    <th>Date</th>
                    <th>JE No</th>
                    <th>Description</th>
                    <th>Source</th>
                    <th className="text-right">Debit</th>
                    <th className="text-right">Credit</th>
                    <th className="text-right">Running (page)</th>
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-t [&>tr]:border-border">
                  {(data.rows ?? []).map((r: any) => {
                    const st = r.journalEntry.sourceType;
                    const sid = r.journalEntry.sourceId;

                    return (
                      <tr key={r.line.id} className="[&>td]:px-3 [&>td]:py-2">
                        <td className="whitespace-nowrap text-muted-foreground">
                          {new Date(r.journalEntry.documentDate).toISOString().slice(0, 10)}
                        </td>
                        <td className="whitespace-nowrap font-mono text-xs">
                          {r.journalEntry.documentNo}
                        </td>
                        <td className="min-w-[240px]">
                          {r.journalEntry.description ?? r.line.description ?? ''}
                        </td>
                        <td className="font-mono text-xs">
                          {st === 'PurchaseReturn' && sid ? (
                            <Link
                              className="text-primary underline-offset-4 hover:underline"
                              href={`/purchasing/returns/${encodeURIComponent(sid)}`}
                            >
                              {st}:{sid}
                            </Link>
                          ) : st === 'SupplierInvoice' && sid ? (
                            <Link
                              className="text-primary underline-offset-4 hover:underline"
                              href={`/purchasing/invoices/${encodeURIComponent(sid)}`}
                            >
                              {st}:{sid}
                            </Link>
                          ) : (
                            <span>
                              {st ?? '-'}:{sid ?? '-'}
                            </span>
                          )}
                        </td>
                        <td className="text-right tabular-nums">
                          {Number(r.line.debit ?? 0).toFixed(2)}
                        </td>
                        <td className="text-right tabular-nums">
                          {Number(r.line.credit ?? 0).toFixed(2)}
                        </td>
                        <td className="text-right tabular-nums text-muted-foreground">
                          {Number(r.runningBalance ?? 0).toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

function buildQuery(params: Record<string, string | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    const s = String(v).trim();
    if (!s) continue;
    sp.set(k, s);
  }
  return sp.toString();
}

export default function GrniPage() {
  const [supplierId, setSupplierId] = useState<string>('');
  const [from, setFrom] = useState<string>(''); // optional
  const [to, setTo] = useState<string>(''); // optional
  const [onlyNonZero, setOnlyNonZero] = useState<boolean>(true);

  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const qs = useMemo(
    () =>
      buildQuery({
        supplierId: supplierId || undefined,
        from: from || undefined,
        to: to || undefined,
        onlyNonZero: onlyNonZero ? 'true' : 'false',
      }),
    [supplierId, from, to, onlyNonZero],
  );

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/acc/reports/grni?${qs}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Failed to load GRNI report');

      setData(body);
    } catch (e: any) {
      setData(null);
      setError(e?.message ?? 'Failed to load GRNI report');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">GRNI Reconciliation (327)</h1>
          <p className="text-sm text-muted-foreground">
            Goods received not invoiced — supplier reconciliation with ledger drilldown.
          </p>
        </div>
        <div className="hidden md:flex items-center gap-2 text-sm">
          <Link className="text-muted-foreground hover:text-foreground" href="/">Home</Link>
          <span className="text-muted-foreground">/</span>
          <Link className="text-muted-foreground hover:text-foreground" href="/accounting/ledger">
            Ledger
          </Link>
          <span className="text-muted-foreground">/</span>
          <Link className="text-muted-foreground hover:text-foreground" href="/accounting/trial-balance">
            Trial Balance
          </Link>
        </div>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Adjust parameters and apply to refresh the report.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Supplier ID (optional)</Label>
              <Input
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                placeholder="partyId"
              />
            </div>

            <div className="space-y-2">
              <Label>From (YYYY-MM-DD)</Label>
              <Input
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="(default: year start)"
              />
            </div>

            <div className="space-y-2">
              <Label>To (YYYY-MM-DD)</Label>
              <Input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="(default: today)"
              />
            </div>

            <div className="space-y-2">
              <Label>Only non-zero</Label>
              <div className="h-9 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={onlyNonZero}
                  onChange={(e) => setOnlyNonZero(e.target.checked)}
                />
                <span className="text-sm text-muted-foreground">{onlyNonZero ? 'true' : 'false'}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <Button onClick={load} disabled={loading}>
              {loading ? 'Loading…' : 'Apply'}
            </Button>
            <div className="text-xs text-muted-foreground">
              Query: <code className="text-foreground">{qs}</code>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading && (
        <Card>
          <CardHeader>
            <CardTitle>Loading</CardTitle>
            <CardDescription>Building GRNI report…</CardDescription>
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
            <CardTitle>
              Account {data.account.code} — {data.account.name}
            </CardTitle>
            {data.meta && (
              <CardDescription>
                Effective range: <code>{data.meta.from}</code> → <code>{data.meta.to}</code>, onlyNonZero:{' '}
                <code>{String(data.meta.onlyNonZero)}</code>
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                    <th>Supplier</th>
                    <th className="text-right">Debit</th>
                    <th className="text-right">Credit</th>
                    <th className="text-right">Net</th>
                    <th>Drilldown</th>
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-t [&>tr]:border-border">
                  {(data.rows ?? []).map((r: any, idx: number) => (
                    <tr key={idx} className="[&>td]:px-3 [&>td]:py-2">
                      <td className="min-w-[240px]">
                        <div className="font-medium">{r.supplierName ?? '(unknown)'}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {r.supplierId ?? '(no partyId)'}
                        </div>
                      </td>
                      <td className="text-right tabular-nums">{Number(r.debit ?? 0).toFixed(2)}</td>
                      <td className="text-right tabular-nums">{Number(r.credit ?? 0).toFixed(2)}</td>
                      <td className="text-right tabular-nums">{Number(r.net ?? 0).toFixed(2)}</td>
                      <td>
                        {r.supplierId ? (
                          <Link
                            className="text-primary underline-offset-4 hover:underline"
                            href={`/accounting/ledger?accountCode=327&partyId=${encodeURIComponent(
                              r.supplierId,
                            )}`}
                          >
                            View ledger
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
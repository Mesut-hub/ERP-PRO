'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';

export default function WarehousesPage() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [locations, setLocations] = useState<any[] | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sectorTag, setSectorTag] = useState('');
  const [locCode, setLocCode] = useState('');
  const [locName, setLocName] = useState('');

  async function load() {
    setError(null);
    setOk(null);
    const res = await fetch('/api/inv/warehouses');
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.message ?? 'Failed to load warehouses');
    setRows(Array.isArray(body) ? body : []);
  }

  async function loadLocations(warehouseId: string) {
    setLocations(null);
    const res = await fetch(`/api/inv/warehouses/${encodeURIComponent(warehouseId)}/locations`);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.message ?? 'Failed to load locations');
    setLocations(Array.isArray(body) ? body : []);
  }

  async function createWarehouse() {
    setError(null);
    setOk(null);
    const res = await fetch('/api/inv/warehouses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name, sectorTag: sectorTag || null, isActive: true }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.message ?? 'Create failed');
    setOk('Warehouse created.');
    setCode('');
    setName('');
    setSectorTag('');
    await load();
  }

  async function createLocation() {
    if (!selected) return;
    setError(null);
    setOk(null);
    const res = await fetch(`/api/inv/warehouses/${encodeURIComponent(selected.id)}/locations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: locCode, name: locName || null, isActive: true }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.message ?? 'Create location failed');
    setOk('Location created.');
    setLocCode('');
    setLocName('');
    await loadLocations(selected.id);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Master Data — Warehouses</h1>

      {error && <Alert variant="destructive">{error}</Alert>}
      {ok && <Alert>{ok}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Create Warehouse</CardTitle>
          <CardDescription>Code must be unique (e.g. MAIN, FOOD, ELEC).</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label>Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Sector/Tag</Label>
            <Input value={sectorTag} onChange={(e) => setSectorTag(e.target.value)} placeholder="e.g. Food" />
          </div>
          <div className="flex items-end">
            <Button onClick={() => createWarehouse().catch((e) => setError(e.message))}>Create</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Warehouses</CardTitle>
          <CardDescription>Select a warehouse to manage locations.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows === null ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {rows.map((w) => (
                <button
                  key={w.id}
                  className={`text-left rounded-md border px-3 py-2 ${selected?.id === w.id ? 'bg-muted' : ''}`}
                  onClick={() => {
                    setSelected(w);
                    loadLocations(w.id).catch((e) => setError(e.message));
                  }}
                >
                  <div className="font-medium">{w.code} — {w.name}</div>
                  <div className="text-xs text-muted-foreground">
                    active={String(w.isActive)} {w.sectorTag ? `• tag=${w.sectorTag}` : ''}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle>Locations — {selected.code}</CardTitle>
            <CardDescription>Create and review warehouse locations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>Location Code</Label>
                <Input value={locCode} onChange={(e) => setLocCode(e.target.value)} placeholder="e.g. DEFAULT" />
              </div>
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={locName} onChange={(e) => setLocName(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex items-end">
                <Button onClick={() => createLocation().catch((e) => setError(e.message))}>Add Location</Button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                    <th>Code</th>
                    <th>Name</th>
                    <th>Active</th>
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-t [&>tr]:border-border">
                  {(locations ?? []).map((l) => (
                    <tr key={l.id} className="[&>td]:px-3 [&>td]:py-2">
                      <td className="font-mono">{l.code}</td>
                      <td>{l.name ?? ''}</td>
                      <td className="font-mono">{String(l.isActive)}</td>
                    </tr>
                  ))}
                  {locations && locations.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-3 text-muted-foreground">No locations.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
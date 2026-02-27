'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type CategoryRow = {
  id: string;
  code?: string | null;
  name: string;
  parentId?: string | null;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

async function readJson(res: Response) {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message ?? `Request failed (${res.status})`);
  return body;
}

export default function MasterDataProductCategoriesPage() {
  const [rows, setRows] = useState<CategoryRow[] | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // create
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string>('');

  // edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editParentId, setEditParentId] = useState<string>('');
  const [editIsActive, setEditIsActive] = useState(true);

  const canCreate = useMemo(() => name.trim().length >= 2, [name]);

  async function load() {
    setError(null);
    setOk(null);
    const res = await fetch('/api/md/product-categories');
    const body = await readJson(res);
    setRows(Array.isArray(body) ? body : []);
  }

  useEffect(() => {
    load().catch((e: any) => setError(e?.message ?? 'Failed to load'));
  }, []);

  async function createRow() {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    setOk(null);

    try {
      const res = await fetch('/api/md/product-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim() ? code.trim() : undefined,
          name: name.trim(),
          parentId: parentId ? parentId : undefined,
        }),
      });
      await readJson(res);

      setOk('Category created.');
      setCode('');
      setName('');
      setParentId('');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(r: CategoryRow) {
    setEditingId(r.id);
    setEditName(r.name ?? '');
    setEditParentId(r.parentId ?? '');
    setEditIsActive(r.isActive !== false);
    setOk(null);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit() {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    setOk(null);

    try {
      const res = await fetch(`/api/md/product-categories/${encodeURIComponent(editingId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          parentId: editParentId ? editParentId : null,
          isActive: editIsActive,
        }),
      });
      await readJson(res);

      setOk('Category updated.');
      setEditingId(null);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  const options = rows ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Master Data — Product Categories</h1>

      {error && <Alert variant="destructive">{error}</Alert>}
      {ok && <Alert>{ok}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Create Category</CardTitle>
          <CardDescription>Optional parentId supports category trees.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label>Code (optional)</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. RAW" />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Raw Materials" />
          </div>
          <div className="space-y-1">
            <Label>Parent</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">(none)</option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-4">
            <Button onClick={createRow} disabled={!canCreate || busy}>
              {busy ? 'Saving…' : 'Create'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Categories</CardTitle>
          <CardDescription>Rename, re-parent, deactivate.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows === null ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                    <th>Code</th>
                    <th>Name</th>
                    <th>Parent</th>
                    <th>Active</th>
                    <th className="w-[160px]">Actions</th>
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-t [&>tr]:border-border">
                  {rows.map((r) => {
                    const editing = editingId === r.id;
                    const parentName = r.parentId
                      ? rows.find((x) => x.id === r.parentId)?.name ?? '(unknown)'
                      : '';

                    return (
                      <tr key={r.id} className="[&>td]:px-3 [&>td]:py-2 align-top">
                        <td className="font-mono">{r.code ?? ''}</td>

                        <td>
                          {editing ? (
                            <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                          ) : (
                            r.name
                          )}
                        </td>

                        <td>
                          {editing ? (
                            <select
                              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              value={editParentId}
                              onChange={(e) => setEditParentId(e.target.value)}
                            >
                              <option value="">(none)</option>
                              {options
                                .filter((x) => x.id !== r.id)
                                .map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                            </select>
                          ) : (
                            parentName
                          )}
                        </td>

                        <td className="font-mono">
                          {editing ? (
                            <label className="inline-flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={editIsActive}
                                onChange={(e) => setEditIsActive(e.target.checked)}
                              />
                              {editIsActive ? 'true' : 'false'}
                            </label>
                          ) : (
                            String(r.isActive !== false)
                          )}
                        </td>

                        <td>
                          {!editing ? (
                            <Button variant="outline" size="sm" onClick={() => startEdit(r)}>
                              Edit
                            </Button>
                          ) : (
                            <div className="flex gap-2">
                              <Button size="sm" onClick={saveEdit} disabled={busy}>
                                Save
                              </Button>
                              <Button variant="outline" size="sm" onClick={cancelEdit} disabled={busy}>
                                Cancel
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-3 text-muted-foreground">
                        No categories.
                      </td>
                    </tr>
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
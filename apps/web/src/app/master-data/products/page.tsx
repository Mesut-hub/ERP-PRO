'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type UnitRow = { id: string; code: string; name: string; isActive: boolean };
type VatRow = { code: string; name: string; percent: string; isActive: boolean };
type CategoryRow = { id: string; code?: string | null; name: string; isActive?: boolean };

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  type: string;
  vatCode: string;
  baseUnitId: string;
  categoryId?: string | null;
  isActive: boolean;

  baseUnit?: { id: string; code: string; name: string } | null;
  vatRate?: { code: string; name: string; percent: string } | null;
  category?: { id: string; name: string } | null;
  priceCurrency?: { code: string; name: string; symbol?: string | null } | null;
};

async function readJson(res: Response) {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message ?? `Request failed (${res.status})`);
  return body;
}

export default function MasterDataProductsPage() {
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [vats, setVats] = useState<VatRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // create
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<'GOODS' | 'SERVICE'>('GOODS');
  const [baseUnitId, setBaseUnitId] = useState('');
  const [vatCode, setVatCode] = useState<string>('KDV_20');
  const [categoryId, setCategoryId] = useState<string>('');

  // edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editVatCode, setEditVatCode] = useState<string>('KDV_20');
  const [editBaseUnitId, setEditBaseUnitId] = useState('');
  const [editCategoryId, setEditCategoryId] = useState<string>('');

  const canSubmitCreate = useMemo(() => {
    return sku.trim().length >= 2 && name.trim().length >= 2 && baseUnitId.trim().length > 0 && !!vatCode;
  }, [sku, name, baseUnitId, vatCode]);

  async function loadAll() {
    setError(null);
    setOk(null);

    const [pRes, uRes, vatRes, catRes] = await Promise.all([
      fetch('/api/md/products'),
      fetch('/api/md/units'),
      fetch('/api/md/vat/rates'),
      fetch('/api/md/product-categories'),
    ]);

    const [pBody, uBody, vatBody, catBody] = await Promise.all([
      readJson(pRes),
      readJson(uRes),
      readJson(vatRes),
      readJson(catRes),
    ]);

    setProducts(Array.isArray(pBody) ? pBody : []);
    setUnits(Array.isArray(uBody) ? uBody : []);
    setVats(Array.isArray(vatBody) ? vatBody : []);
    setCategories(Array.isArray(catBody) ? catBody : []);

    const firstActiveUnit = (Array.isArray(uBody) ? uBody : []).find((x: any) => x.isActive);
    if (!baseUnitId && firstActiveUnit?.id) setBaseUnitId(firstActiveUnit.id);

    const firstActiveVat = (Array.isArray(vatBody) ? vatBody : []).find((x: any) => x.isActive);
    if (!vatCode && firstActiveVat?.code) setVatCode(firstActiveVat.code);
  }

  useEffect(() => {
    loadAll().catch((e: any) => setError(e?.message ?? 'Failed to load'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createProduct() {
    if (!canSubmitCreate) return;
    setBusy(true);
    setError(null);
    setOk(null);

    try {
      const res = await fetch('/api/md/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: sku.trim(),
          name: name.trim(),
          type,
          baseUnitId,
          vatCode,
          categoryId: categoryId ? categoryId : undefined,
        }),
      });
      await readJson(res);

      setOk('Product created.');
      setSku('');
      setName('');
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(p: ProductRow) {
    setEditingId(p.id);
    setEditName(p.name);
    setEditIsActive(!!p.isActive);
    setEditVatCode(p.vatCode);
    setEditBaseUnitId(p.baseUnitId);
    setEditCategoryId(p.categoryId ?? '');
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
      const res = await fetch(`/api/md/products/${encodeURIComponent(editingId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          isActive: editIsActive,
          vatCode: editVatCode,
          baseUnitId: editBaseUnitId,
          categoryId: editCategoryId ? editCategoryId : null,
        }),
      });
      await readJson(res);

      setOk('Product updated.');
      setEditingId(null);
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Master Data — Products</h1>

      {error && <Alert variant="destructive">{error}</Alert>}
      {ok && <Alert>{ok}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Create Product</CardTitle>
          <CardDescription>SKU should be unique and stable.</CardDescription>
        </CardHeader>

        <CardContent className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="space-y-1 md:col-span-2">
            <Label>SKU</Label>
            <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. DEMO-SKU-001" />
          </div>

          <div className="space-y-1 md:col-span-3">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Demo Product" />
          </div>

          <div className="space-y-1 md:col-span-1">
            <Label>Type</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value as any)}
            >
              <option value="GOODS">GOODS</option>
              <option value="SERVICE">SERVICE</option>
            </select>
          </div>

          <div className="space-y-1 md:col-span-2">
            <Label>Base Unit</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={baseUnitId}
              onChange={(e) => setBaseUnitId(e.target.value)}
            >
              <option value="">Select…</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} — {u.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1 md:col-span-2">
            <Label>VAT</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={vatCode}
              onChange={(e) => setVatCode(e.target.value)}
            >
              {vats.map((v) => (
                <option key={v.code} value={v.code}>
                  {v.code} — {v.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1 md:col-span-2">
            <Label>Category</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">(none)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-6">
            <Button onClick={createProduct} disabled={!canSubmitCreate || busy}>
              {busy ? 'Saving…' : 'Create'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Products</CardTitle>
          <CardDescription>List, edit, deactivate.</CardDescription>
        </CardHeader>

        <CardContent>
          {products === null ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                    <th>SKU</th>
                    <th>Name</th>
                    <th>Unit</th>
                    <th>VAT</th>
                    <th>Category</th>
                    <th>Active</th>
                    <th className="w-[160px]">Actions</th>
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-t [&>tr]:border-border">
                  {products.map((p) => {
                    const editing = editingId === p.id;
                    const unitLabel = p.baseUnit ? `${p.baseUnit.code}` : '';
                    const vatLabel = p.vatRate
                      ? `${p.vatRate.code} (${p.vatRate.percent}%)`
                      : p.vatCode;
                    const catLabel = p.category?.name ?? '';

                    return (
                      <tr key={p.id} className="[&>td]:px-3 [&>td]:py-2 align-top">
                        <td className="font-mono">{p.sku}</td>

                        <td>
                          {editing ? (
                            <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                          ) : (
                            p.name
                          )}
                        </td>

                        <td>{unitLabel}</td>

                        <td>
                          {editing ? (
                            <select
                              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              value={editVatCode}
                              onChange={(e) => setEditVatCode(e.target.value)}
                            >
                              {vats.map((v) => (
                                <option key={v.code} value={v.code}>
                                  {v.code} — {v.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            vatLabel
                          )}
                        </td>

                        <td>{catLabel}</td>

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
                            String(p.isActive)
                          )}
                        </td>

                        <td>
                          {!editing ? (
                            <Button variant="outline" size="sm" onClick={() => startEdit(p)}>
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

                  {products.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-3 text-muted-foreground">
                        No products.
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
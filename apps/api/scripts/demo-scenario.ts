/**
 * Demo scenario runner (dev only):
 * Creates fresh Purchasing documents through the API so accounting entries are correct.
 *
 * Usage:
 *   cd apps/api
 *   node scripts/demo-scenario.ts
 *
 * Requires:
 *   API running (e.g. http://localhost:3001)
 *   Seed already ran (base + demo entities)
 */

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3001';

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${res.status} ${path}: ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run demo scenario in production.');
  }

  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'Welcome-123';

  const login = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  const token = login.accessToken as string;

  // Lookups
  const whs = await api('/inv/warehouses', { method: 'GET', token });
  const whId = whs.find((w: any) => w.code === 'MAIN')?.id;
  if (!whId) throw new Error('MAIN warehouse not found');

  const units = await api('/md/units', { method: 'GET', token });
  const pcsId = units.find((u: any) => u.code === 'PCS')?.id;
  if (!pcsId) throw new Error('PCS unit not found');

  const parties = await api('/md/parties?type=SUPPLIER', { method: 'GET', token });
  const supA = parties.find((p: any) => p.code === 'SUP-DEMO-A')?.id;
  const supB = parties.find((p: any) => p.code === 'SUP-DEMO-B')?.id;
  if (!supA || !supB) throw new Error('Demo suppliers missing (run seed with SEED_MODE=demo)');

  const products = await api('/md/products', { method: 'GET', token });
  const productId = products.find((p: any) => p.sku === 'DEMO-SKU-001')?.id;
  if (!productId) throw new Error('Demo product missing (run seed with SEED_MODE=demo)');

  async function runForSupplier(supplierId: string, qty: string, unitPrice: string) {
    const po = await api('/pur/pos', {
      method: 'POST',
      token,
      body: JSON.stringify({
        supplierId,
        warehouseId: whId,
        currencyCode: 'USD',
        exchangeRateToBase: '30',
        lines: [{ productId, unitId: pcsId, quantity: qty, unitPrice, vatCode: 'KDV_20' }],
      }),
    });

    await api(`/pur/pos/${po.id}/approve`, { method: 'POST', token, body: JSON.stringify({}) });

    const poLineId = po.lines[0].id;
    const grn = await api(`/pur/pos/${po.id}/receive`, {
      method: 'POST',
      token,
      body: JSON.stringify({ lines: [{ poLineId, quantity: qty }] }),
    });

    const receiptId = grn.receiptId;
    const receipt = await api(`/pur/receipts/${receiptId}`, { method: 'GET', token });
    const receiptLineId = receipt.lines[0].id;

    const inv = await api('/pur/invoices', {
      method: 'POST',
      token,
      body: JSON.stringify({
        supplierId,
        poId: po.id,
        currencyCode: 'USD',
        exchangeRateToBase: '30',
        documentDate: new Date().toISOString(),
        notes: 'Demo invoice (seed)',
        lines: [
          { poLineId, productId, description: 'Demo line', quantity: qty, unitPrice, vatCode: 'KDV_20' },
        ],
      }),
    });

    await api(`/pur/invoices/${inv.id}/post`, { method: 'POST', token, body: JSON.stringify({}) });

    // Optional: create a small SCN + return to populate 328
    const scn = await api('/pur/invoice-notes', {
      method: 'POST',
      token,
      body: JSON.stringify({
        kind: 'CREDIT_NOTE',
        noteOfId: inv.id,
        reason: 'Demo SCN (seed)',
        documentDate: new Date().toISOString(),
        lines: [
          { poLineId, productId, description: 'Demo SCN line', quantity: '1', unitPrice, vatCode: 'KDV_20' },
        ],
      }),
    });
    await api(`/pur/invoices/${scn.id}/post`, { method: 'POST', token, body: JSON.stringify({}) });

    await api(`/pur/receipts/${receiptId}/return`, {
      method: 'POST',
      token,
      body: JSON.stringify({
        documentDate: new Date().toISOString(),
        reason: 'Demo return (seed)',
        notes: 'Seeded return',
        supplierCreditNoteId: scn.id,
        lines: [{ receiptLineId, quantity: '1' }],
      }),
    });
  }

  await runForSupplier(supA, '2', '10');   // smaller
  await runForSupplier(supB, '10', '100'); // larger

  console.log('Demo scenario completed. Now check Ledger/GRNI/Trial Balance in web.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
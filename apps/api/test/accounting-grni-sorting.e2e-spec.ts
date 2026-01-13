import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/modules/app/app.module';

describe('Accounting reports: GRNI sorted by abs(net) desc (e2e)', () => {
  jest.setTimeout(90_000);

  let app: INestApplication;
  let httpServer: any;
  let h: { Authorization: string };

  beforeAll(async () => {
    const modRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modRef.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer();

    const loginRes = await request(httpServer)
      .post('/auth/login')
      .send({ email: 'admin@example.com', password: 'Welcome-123' })
      .expect(201);

    h = { Authorization: `Bearer ${loginRes.body.accessToken}` };
  });

  afterAll(async () => {
    await app.close();
  });

  async function ensureSupplier(name: string, email: string) {
    // Try find by listing first (stable even if unique constraints vary)
    const list = await request(httpServer).get('/md/parties?type=SUPPLIER').set(h).expect(200);
    const found = (list.body ?? []).find((p: any) => p.email === email || p.name === name);
    if (found) return found.id;

    const created = await request(httpServer)
      .post('/md/parties')
      .set(h)
      .send({
        type: 'SUPPLIER',
        name,
        email,
        isActive: true,
        defaultCurrencyCode: 'USD',
      })
      .expect(201);

    return created.body.id;
  }

  async function ensureProduct(pcsId: string) {
    const prodRes = await request(httpServer).get('/md/products').set(h).expect(200);
    const sku = `E2E-GRNI-SORT-${Date.now()}`;
    const existing = (prodRes.body ?? []).find((p: any) => p.sku === sku);
    if (existing) return existing.id;

    const created = await request(httpServer)
      .post('/md/products')
      .set(h)
      .send({
        sku,
        name: 'E2E Product (GRNI sorting)',
        type: 'GOODS',
        baseUnitId: pcsId,
        vatCode: 'KDV_20',
        isActive: true,
      })
      .expect(201);

    return created.body.id;
  }

  async function createAndReceivePO(params: {
    supplierId: string;
    warehouseId: string;
    productId: string;
    unitId: string;
    qty: string;
    unitPrice: string;
  }) {
    const poRes = await request(httpServer)
      .post('/pur/pos')
      .set(h)
      .send({
        supplierId: params.supplierId,
        warehouseId: params.warehouseId,
        currencyCode: 'USD',
        exchangeRateToBase: '30',
        lines: [
          {
            productId: params.productId,
            unitId: params.unitId,
            quantity: params.qty,
            unitPrice: params.unitPrice,
            vatCode: 'KDV_20',
          },
        ],
      })
      .expect(201);

    const poId = poRes.body.id;
    const poLineId = poRes.body.lines[0].id;

    await request(httpServer).post(`/pur/pos/${poId}/approve`).set(h).send({}).expect(201);

    await request(httpServer)
      .post(`/pur/pos/${poId}/receive`)
      .set(h)
      .send({ lines: [{ poLineId, quantity: params.qty }] })
      .expect(201);
  }

  it('returns GRNI rows sorted by abs(net) desc', async () => {
    // Warehouse + Unit
    const whRes = await request(httpServer).get('/inv/warehouses').set(h).expect(200);
    const whId = whRes.body.find((w: any) => w.code === 'MAIN')?.id;
    expect(whId).toBeTruthy();

    const unitRes = await request(httpServer).get('/md/units').set(h).expect(200);
    const pcsId = unitRes.body.find((u: any) => u.code === 'PCS')?.id;
    expect(pcsId).toBeTruthy();

    // Ensure two suppliers
    const supA = await ensureSupplier('E2E Supplier A (GRNI sort)', `e2e-grni-a-${Date.now()}@example.com`);
    const supB = await ensureSupplier('E2E Supplier B (GRNI sort)', `e2e-grni-b-${Date.now()}@example.com`);
    expect(supA).toBeTruthy();
    expect(supB).toBeTruthy();

    const productId = await ensureProduct(pcsId);
    expect(productId).toBeTruthy();

    // Create GRNI movements with different magnitudes:
    // Supplier A: 1 * 1 => smaller
    // Supplier B: 10 * 100 => larger
    // (We don't assert exact amounts because FX/VAT/rounding can affect; we only need different abs(net).)
    await createAndReceivePO({
      supplierId: supA,
      warehouseId: whId,
      productId,
      unitId: pcsId,
      qty: '1',
      unitPrice: '1',
    });

    await createAndReceivePO({
      supplierId: supB,
      warehouseId: whId,
      productId,
      unitId: pcsId,
      qty: '10',
      unitPrice: '100',
    });

    const res = await request(httpServer)
      .get('/acc/reports/grni?onlyNonZero=true')
      .set(h)
      .expect(200);

    expect(res.body.account?.code).toBe('327');
    expect(Array.isArray(res.body.rows)).toBe(true);

    // Extract only our two suppliers (report might include seed data too)
    const rows = res.body.rows.filter((r: any) => r.supplierId === supA || r.supplierId === supB);
    expect(rows.length).toBe(2);

    const abs0 = Math.abs(Number(rows[0].net));
    const abs1 = Math.abs(Number(rows[1].net));

    // Must be sorted desc by abs(net)
    expect(abs0).toBeGreaterThanOrEqual(abs1);
  });
});
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/modules/app/app.module';

describe('Purchasing: GRNI multi-currency (e2e)', () => {
  jest.setTimeout(60_000);

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

  it('produces GRNI JE with base TRY amounts when PO currency is USD', async () => {
    // ---- Warehouse + Unit (seeded) ----
    const whRes = await request(httpServer).get('/inv/warehouses').set(h).expect(200);
    const whId = whRes.body.find((w: any) => w.code === 'MAIN')?.id;
    expect(whId).toBeTruthy();

    const unitRes = await request(httpServer).get('/md/units').set(h).expect(200);
    const pcsId = unitRes.body.find((u: any) => u.code === 'PCS')?.id;
    expect(pcsId).toBeTruthy();

    // ---- Ensure supplier exists (create if missing) ----
    const supRes = await request(httpServer).get('/md/parties?type=SUPPLIER').set(h).expect(200);

    let supplierId = supRes.body[0]?.id;

    if (!supplierId) {
      const supCreate = await request(httpServer)
        .post('/md/parties')
        .set(h)
        .send({
          type: 'SUPPLIER',
          name: 'E2E FX Supplier',
          email: 'supplier-fx@example.com',
          isActive: true,
          defaultCurrencyCode: 'USD',
        })
        .expect(201);

      supplierId = supCreate.body.id;
    }

    expect(supplierId).toBeTruthy();

    // ---- Ensure product exists (create if missing) ----
    const prodRes = await request(httpServer).get('/md/products').set(h).expect(200);

    let productId = prodRes.body[0]?.id;

    if (!productId) {
      const prodCreate = await request(httpServer)
        .post('/md/products')
        .set(h)
        .send({
          sku: 'E2E-FX-SKU-001',
          name: 'E2E FX Product',
          type: 'GOODS',
          baseUnitId: pcsId,
          vatCode: 'KDV_20',
          isActive: true,
        })
        .expect(201);

      productId = prodCreate.body.id;
    }

    expect(productId).toBeTruthy();

    // ---- Create USD PO with exchangeRateToBase=30 ----
    // qty=1, unitPrice=$50 => net=$50 => in TRY=1500
    const poRes = await request(httpServer)
      .post('/pur/pos')
      .set(h)
      .send({
        supplierId,
        warehouseId: whId,
        currencyCode: 'USD',
        exchangeRateToBase: '30',
        lines: [
          {
            productId,
            unitId: pcsId,
            quantity: '1',
            unitPrice: '50',
            vatCode: 'KDV_20',
          },
        ],
      })
      .expect(201);

    const poId = poRes.body.id;
    const poLineId = poRes.body.lines[0].id;

    // Approve PO
    await request(httpServer).post(`/pur/pos/${poId}/approve`).set(h).send({}).expect(201);

    // Receive PO (GRN)
    const grnRes = await request(httpServer)
      .post(`/pur/pos/${poId}/receive`)
      .set(h)
      .send({ lines: [{ poLineId, quantity: '1' }] })
      .expect(201);

    const receiptId = grnRes.body.receiptId;

    // Query journal entries by source
    const jeRes = await request(httpServer)
      .get(
        `/acc/journals/by-source?sourceType=${encodeURIComponent('PurchaseReceipt')}&sourceId=${encodeURIComponent(receiptId)}`,
      )
      .set(h)
      .expect(200);

    expect(Array.isArray(jeRes.body)).toBe(true);
    expect(jeRes.body.length).toBeGreaterThan(0);

    const je = jeRes.body[0];
    expect(je).toBeTruthy();
    expect(je.status).toBe('POSTED');
    expect(Array.isArray(je.lines)).toBe(true);
    expect(je.lines.length).toBe(2);

    // Find the inventory debit line (account 150)
    const invLine = je.lines.find((l: any) => l.account?.code === '150');
    expect(invLine).toBeTruthy();
    expect(invLine.debit).toBe('1500.00'); // base TRY: $50 * 30
    expect(invLine.credit).toBe('0');
    expect(invLine.currencyCode).toBe('USD');
    expect(invLine.amountCurrency).toBe('50.00'); // document currency

    // Find the GRNI credit line (account 327)
    const grniLine = je.lines.find((l: any) => l.account?.code === '327');
    expect(grniLine).toBeTruthy();
    expect(grniLine.debit).toBe('0');
    expect(grniLine.credit).toBe('1500.00'); // base TRY: $50 * 30
    expect(grniLine.currencyCode).toBe('USD');
    expect(grniLine.amountCurrency).toBe('50.00'); // document currency
  });
});

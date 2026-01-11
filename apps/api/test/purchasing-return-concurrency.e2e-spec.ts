import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/modules/app/app.module';

describe('Purchasing: return concurrency guard (e2e)', () => {
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

  it('does not allow concurrent returns to exceed received qty', async () => {
    // Warehouse + Unit
    const whRes = await request(httpServer).get('/inv/warehouses').set(h).expect(200);
    const whId = whRes.body.find((w: any) => w.code === 'MAIN')?.id;
    expect(whId).toBeTruthy();

    const unitRes = await request(httpServer).get('/md/units').set(h).expect(200);
    const pcsId = unitRes.body.find((u: any) => u.code === 'PCS')?.id;
    expect(pcsId).toBeTruthy();

    // Supplier
    const supRes = await request(httpServer).get('/md/parties?type=SUPPLIER').set(h).expect(200);
    let supplierId = supRes.body[0]?.id;
    if (!supplierId) {
      const supCreate = await request(httpServer)
        .post('/md/parties')
        .set(h)
        .send({
          type: 'SUPPLIER',
          name: 'E2E Supplier',
          email: 'supplier.e2e@example.com',
          isActive: true,
          defaultCurrencyCode: 'USD',
        })
        .expect(201);
      supplierId = supCreate.body.id;
    }

    // Product
    const prodRes = await request(httpServer).get('/md/products').set(h).expect(200);
    let productId = prodRes.body[0]?.id;
    if (!productId) {
      const prodCreate = await request(httpServer)
        .post('/md/products')
        .set(h)
        .send({
          sku: 'E2E-SKU-CONC-001',
          name: 'E2E Product Concurrency',
          type: 'GOODS',
          baseUnitId: pcsId,
          vatCode: 'KDV_20',
          isActive: true,
        })
        .expect(201);
      productId = prodCreate.body.id;
    }

    // PO
    const poRes = await request(httpServer)
      .post('/pur/pos')
      .set(h)
      .send({
        supplierId,
        warehouseId: whId,
        currencyCode: 'USD',
        exchangeRateToBase: '30',
        lines: [{ productId, unitId: pcsId, quantity: '2', unitPrice: '5', vatCode: 'KDV_20' }],
      })
      .expect(201);

    const poId = poRes.body.id;
    const poLineId = poRes.body.lines[0].id;

    await request(httpServer).post(`/pur/pos/${poId}/approve`).set(h).send({}).expect(201);

    // GRN receive 2
    const grnRes = await request(httpServer)
      .post(`/pur/pos/${poId}/receive`)
      .set(h)
      .send({ lines: [{ poLineId, quantity: '2' }] })
      .expect(201);

    const receiptId = grnRes.body.receiptId;
    const receiptRes = await request(httpServer).get(`/pur/receipts/${receiptId}`).set(h).expect(200);
    const receiptLineId = receiptRes.body.lines[0].id;

    // Concurrency: two returns of qty 2 each -> total 4 > received 2
    const docDate = new Date().toISOString();
    const req1 = request(httpServer)
      .post(`/pur/receipts/${receiptId}/return`)
      .set(h)
      .send({
        documentDate: docDate,
        reason: 'Concurrent return 1',
        notes: 'r1',
        lines: [{ receiptLineId, quantity: '2' }],
      });

    const req2 = request(httpServer)
      .post(`/pur/receipts/${receiptId}/return`)
      .set(h)
      .send({
        documentDate: docDate,
        reason: 'Concurrent return 2',
        notes: 'r2',
        lines: [{ receiptLineId, quantity: '2' }],
      });

    const results = await Promise.allSettled([req1, req2]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const rejected = results.filter((r) => r.status === 'rejected');

    // If supertest rejects, it's an infra error. We mostly expect both fulfilled with different HTTP statuses.
    expect(rejected.length).toBe(0);

    const statuses = fulfilled.map((r) => r.value.status).sort();
    // Expect: one succeeds (201) and one fails (400)
    expect(statuses.filter((s) => s === 201).length).toBe(1);

    const failureStatus = statuses.find((s) => s !== 201);
    expect([400, 403, 409]).toContain(failureStatus);
  });
});
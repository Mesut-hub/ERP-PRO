import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/modules/app/app.module';

describe('Purchasing: SCN clearing JE idempotency (e2e)', () => {
  async function getJEsBySource(httpServer: any, h: any, sourceType: string, sourceId: string) {
    const res = await request(httpServer)
      .get(`/acc/journals/by-source?sourceType=${encodeURIComponent(sourceType)}&sourceId=${encodeURIComponent(sourceId)}`)
      .set(h)
      .expect(200);
    return res.body;
  }

  function countAccountCredits(jes: any[], accountCode: string) {
    let count = 0;
    for (const je of jes) {
      for (const ln of je.lines ?? []) {
        if (ln.account?.code === accountCode && Number(ln.credit) > 0) count += 1;
      }
    }
    return count;
  }

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

  it('creates at most one SCN clearing JE that credits 328 even with multiple returns linked to same SCN', async () => {
    // Seeded warehouse/unit
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
    expect(supplierId).toBeTruthy();

    // Product
    const prodRes = await request(httpServer).get('/md/products').set(h).expect(200);
    let productId = prodRes.body[0]?.id;
    if (!productId) {
      const prodCreate = await request(httpServer)
        .post('/md/products')
        .set(h)
        .send({
          sku: 'E2E-SKU-IDEMP-001',
          name: 'E2E Product Idempotency',
          type: 'GOODS',
          baseUnitId: pcsId,
          vatCode: 'KDV_20',
          isActive: true,
        })
        .expect(201);
      productId = prodCreate.body.id;
    }
    expect(productId).toBeTruthy();

    // PO
    const poRes = await request(httpServer)
      .post('/pur/pos')
      .set(h)
      .send({
        supplierId,
        warehouseId: whId,
        currencyCode: 'USD',
        exchangeRateToBase: '30',
        lines: [{ productId, unitId: pcsId, quantity: '10', unitPrice: '5', vatCode: 'KDV_20' }],
      })
      .expect(201);

    const poId = poRes.body.id;
    const poLineId = poRes.body.lines[0].id;

    await request(httpServer).post(`/pur/pos/${poId}/approve`).set(h).send({}).expect(201);

    // GRN receive 10
    const grnRes = await request(httpServer)
      .post(`/pur/pos/${poId}/receive`)
      .set(h)
      .send({ lines: [{ poLineId, quantity: '10' }] })
      .expect(201);

    const receiptId = grnRes.body.receiptId;
    const receiptRes = await request(httpServer).get(`/pur/receipts/${receiptId}`).set(h).expect(200);
    const receiptLineId = receiptRes.body.lines[0].id;

    // Invoice post
    const invDate = new Date().toISOString();
    const invRes = await request(httpServer)
      .post('/pur/invoices')
      .set(h)
      .send({
        supplierId,
        poId,
        currencyCode: 'USD',
        exchangeRateToBase: '30',
        documentDate: invDate,
        notes: 'Invoice for idempotency test',
        lines: [{ poLineId, productId, description: 'Invoice line', quantity: '10', unitPrice: '5', vatCode: 'KDV_20' }],
      })
      .expect(201);
    const invoiceId = invRes.body.id;
    await request(httpServer).post(`/pur/invoices/${invoiceId}/post`).set(h).send({}).expect(201);

    // SCN create + post (PO-matched requires poLineId)
    const scnDate = new Date().toISOString();
    const cnRes = await request(httpServer)
      .post('/pur/invoice-notes')
      .set(h)
      .send({
        kind: 'CREDIT_NOTE',
        noteOfId: invoiceId,
        reason: 'Idempotency proof SCN',
        documentDate: scnDate,
        lines: [{ poLineId, productId, description: 'SCN line', quantity: '2', unitPrice: '5', vatCode: 'KDV_20' }],
      })
      .expect(201);

    const creditNoteId = cnRes.body.id;
    await request(httpServer).post(`/pur/invoices/${creditNoteId}/post`).set(h).send({}).expect(201);

    // Return #1 linked to SCN
    const ret1 = await request(httpServer)
      .post(`/pur/receipts/${receiptId}/return`)
      .set(h)
      .send({
        documentDate: scnDate,
        reason: 'Return 1 linked to SCN',
        notes: 'Return 1',
        supplierCreditNoteId: creditNoteId,
        lines: [{ receiptLineId, quantity: '1' }],
      })
      .expect(201);

    expect(ret1.body.purchaseReturnId).toBeTruthy();

    // Return #2 linked to same SCN
    const ret2 = await request(httpServer)
      .post(`/pur/receipts/${receiptId}/return`)
      .set(h)
      .send({
        documentDate: scnDate,
        reason: 'Return 2 linked to same SCN',
        notes: 'Return 2',
        supplierCreditNoteId: creditNoteId,
        lines: [{ receiptLineId, quantity: '1' }],
      })
      .expect(201);

    expect(ret2.body.purchaseReturnId).toBeTruthy();

    // SCN JEs: must include at most one JE that credits 328
    const scnJes = await getJEsBySource(httpServer, h, 'SupplierInvoice', creditNoteId);
    expect(Array.isArray(scnJes)).toBe(true);
    expect(scnJes.length).toBeGreaterThan(0);

    const credits328Count = countAccountCredits(scnJes, '328');
    expect(credits328Count).toBe(1);
  });
});
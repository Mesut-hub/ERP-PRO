import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/modules/app/app.module';

describe('Accounting reports: ledger filters (e2e)', () => {
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

  it('filters ledger by sourceType', async () => {
    // Setup minimal scenario producing PurchaseReturn JE hitting 328:
    const whRes = await request(httpServer).get('/inv/warehouses').set(h).expect(200);
    const whId = whRes.body.find((w: any) => w.code === 'MAIN')?.id;
    expect(whId).toBeTruthy();

    const unitRes = await request(httpServer).get('/md/units').set(h).expect(200);
    const pcsId = unitRes.body.find((u: any) => u.code === 'PCS')?.id;
    expect(pcsId).toBeTruthy();

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

    const prodRes = await request(httpServer).get('/md/products').set(h).expect(200);
    let productId = prodRes.body[0]?.id;
    if (!productId) {
      const prodCreate = await request(httpServer)
        .post('/md/products')
        .set(h)
        .send({
          sku: `E2E-LEDGER-FLT-${Date.now()}`,
          name: 'E2E Product (ledger filter)',
          type: 'GOODS',
          baseUnitId: pcsId,
          vatCode: 'KDV_20',
          isActive: true,
        })
        .expect(201);
      productId = prodCreate.body.id;
    }

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

    const grnRes = await request(httpServer)
      .post(`/pur/pos/${poId}/receive`)
      .set(h)
      .send({ lines: [{ poLineId, quantity: '2' }] })
      .expect(201);

    const receiptId = grnRes.body.receiptId;
    const receiptRes = await request(httpServer).get(`/pur/receipts/${receiptId}`).set(h).expect(200);
    const receiptLineId = receiptRes.body.lines[0].id;

    // post invoice
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
        notes: 'Invoice for ledger filter test',
        lines: [{ poLineId, productId, description: 'Invoice line', quantity: '2', unitPrice: '5', vatCode: 'KDV_20' }],
      })
      .expect(201);
    const invoiceId = invRes.body.id;

    await request(httpServer).post(`/pur/invoices/${invoiceId}/post`).set(h).send({}).expect(201);

    // create + post SCN
    const cnRes = await request(httpServer)
      .post('/pur/invoice-notes')
      .set(h)
      .send({
        kind: 'CREDIT_NOTE',
        noteOfId: invoiceId,
        reason: 'Ledger filter SCN',
        documentDate: invDate,
        lines: [{ poLineId, productId, description: 'SCN line', quantity: '1', unitPrice: '5', vatCode: 'KDV_20' }],
      })
      .expect(201);
    const creditNoteId = cnRes.body.id;
    await request(httpServer).post(`/pur/invoices/${creditNoteId}/post`).set(h).send({}).expect(201);

    // return linked to SCN (creates PurchaseReturn JE hitting 328)
    await request(httpServer)
      .post(`/pur/receipts/${receiptId}/return`)
      .set(h)
      .send({
        documentDate: invDate,
        reason: 'Return for ledger filter',
        notes: 'Return',
        supplierCreditNoteId: creditNoteId,
        lines: [{ receiptLineId, quantity: '1' }],
      })
      .expect(201);

    const ledgerRes = await request(httpServer)
      .get('/acc/reports/ledger?accountCode=328&sourceType=PurchaseReturn')
      .set(h)
      .expect(200);

    expect(ledgerRes.body.meta).toBeTruthy();
    expect(typeof ledgerRes.body.meta.total).toBe('number');

    for (const r of ledgerRes.body.rows ?? []) {
      expect(r.journalEntry.sourceType).toBe('PurchaseReturn');
    }
  });
});
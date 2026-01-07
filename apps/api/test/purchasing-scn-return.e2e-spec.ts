import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/modules/app/app.module';

describe('Purchasing: invoice -> SCN -> purchase return (e2e)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let httpServer: any;

  let token: string;
  let h: { Authorization: string };

  beforeAll(async () => {
    const modRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = modRef.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer();

    const loginRes = await request(httpServer)
      .post('/auth/login')
      .send({ email: 'admin@example.com', password: 'Welcome-123' })
      .expect(201);

    token = loginRes.body.accessToken;
    h = { Authorization: `Bearer ${token}` };
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks return after invoice unless SCN is POSTED; allows with SCN', async () => {
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
          name: 'E2E Supplier',
          email: 'supplier.e2e@example.com',
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
          sku: 'E2E-SKU-001',
          name: 'E2E Product',
          type: 'GOODS',
          baseUnitId: pcsId,
          vatCode: 'KDV_20',
          isActive: true,
        })
        .expect(201);

      productId = prodCreate.body.id;
    }

    expect(productId).toBeTruthy();

    // create PO
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
            quantity: '10',
            unitPrice: '5',
            vatCode: 'KDV_20',
          },
        ],
      })
      .expect(201);

    const poId = poRes.body.id;
    const poLineId = poRes.body.lines[0].id;

    await request(httpServer).post(`/pur/pos/${poId}/approve`).set(h).send({}).expect(201);

    // GRN
    const grnRes = await request(httpServer)
      .post(`/pur/pos/${poId}/receive`)
      .set(h)
      .send({ lines: [{ poLineId, quantity: '10' }] })
      .expect(201);

    const receiptId = grnRes.body.receiptId;

    const receiptRes = await request(httpServer).get(`/pur/receipts/${receiptId}`).set(h).expect(200);
    const receiptLineId = receiptRes.body.lines[0].id;

    // create invoice
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
        notes: 'Invoice for SCN return test',
        lines: [
          {
            poLineId,
            productId,
            description: 'Invoice line',
            quantity: '10',
            unitPrice: '5',
            vatCode: 'KDV_20',
          },
        ],
      })
      .expect(201);

    const invoiceId = invRes.body.id;

    // post invoice
    await request(httpServer).post(`/pur/invoices/${invoiceId}/post`).set(h).send({}).expect(201);

    // return should be blocked (no SCN)
    const returnDate = new Date().toISOString();
    await request(httpServer)
      .post(`/pur/receipts/${receiptId}/return`)
      .set(h)
      .send({
        documentDate: returnDate,
        reason: 'After invoice - should be blocked',
        notes: 'Expect failure',
        lines: [{ receiptLineId, quantity: '1' }],
      })
      .expect(400);

    // create credit note
    const cnRes = await request(httpServer)
      .post('/pur/invoice-notes')
      .set(h)
      .send({
        kind: 'CREDIT_NOTE',
        noteOfId: invoiceId,
        reason: 'Supplier accepted return; issuing credit note',
        documentDate: returnDate,
        lines: [
          {
            description: 'Credit note line',
            quantity: '1',
            unitPrice: '5',
            vatCode: 'KDV_20',
            productId,
          },
        ],
      })
      .expect(201);

    const creditNoteId = cnRes.body.id;

    // post credit note
    await request(httpServer).post(`/pur/invoices/${creditNoteId}/post`).set(h).send({}).expect(201);

    // return should succeed with SCN
    const okReturn = await request(httpServer)
      .post(`/pur/receipts/${receiptId}/return`)
      .set(h)
      .send({
        documentDate: returnDate,
        reason: 'After invoice with posted credit note',
        notes: 'Should succeed',
        supplierCreditNoteId: creditNoteId,
        lines: [{ receiptLineId, quantity: '1' }],
      })
      .expect(201);

    expect(okReturn.body.purchaseReturnId).toBeTruthy();
    expect(okReturn.body.totalCost).toBeTruthy();
  });
});
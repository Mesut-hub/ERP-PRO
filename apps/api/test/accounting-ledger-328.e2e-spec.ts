import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/modules/app/app.module';

describe('Accounting رپور: ledger 328 shows PurchaseReturn debit and SCN clearing credit (e2e)', () => {
  jest.setTimeout(90_000);

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

  it('ledger(328) includes debit and credit lines after SCN + purchase return workflow', async () => {
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

    // ---- Ensure product exists (create if missing) ----
    const prodRes = await request(httpServer).get('/md/products').set(h).expect(200);
    let productId = prodRes.body[0]?.id;

    if (!productId) {
      const prodCreate = await request(httpServer)
        .post('/md/products')
        .set(h)
        .send({
          sku: `E2E-LEDGER-328-${Date.now()}`,
          name: 'E2E Product (ledger 328)',
          type: 'GOODS',
          baseUnitId: pcsId,
          vatCode: 'KDV_20',
          isActive: true,
        })
        .expect(201);

      productId = prodCreate.body.id;
    }

    // ---- Create PO ----
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

    // ---- GRN ----
    const grnRes = await request(httpServer)
      .post(`/pur/pos/${poId}/receive`)
      .set(h)
      .send({ lines: [{ poLineId, quantity: '10' }] })
      .expect(201);

    const receiptId = grnRes.body.receiptId;
    const receiptRes = await request(httpServer).get(`/pur/receipts/${receiptId}`).set(h).expect(200);
    const receiptLineId = receiptRes.body.lines[0].id;

    // ---- Create + post invoice ----
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
        notes: 'Invoice for ledger 328 test',
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
    await request(httpServer).post(`/pur/invoices/${invoiceId}/post`).set(h).send({}).expect(201);

    // ---- Create + post SCN ----
    const docDate = new Date().toISOString();
    const cnRes = await request(httpServer)
      .post('/pur/invoice-notes')
      .set(h)
      .send({
        kind: 'CREDIT_NOTE',
        noteOfId: invoiceId,
        reason: 'Ledger 328 test credit note (SCN)',
        documentDate: docDate,
        lines: [
          {
            poLineId,
            productId,
            description: 'Credit note line',
            quantity: '1',
            unitPrice: '5',
            vatCode: 'KDV_20',
          },
        ],
      })
      .expect(201);

    const creditNoteId = cnRes.body.id;
    await request(httpServer).post(`/pur/invoices/${creditNoteId}/post`).set(h).send({}).expect(201);

    // ---- Create purchase return linked to SCN ----
    await request(httpServer)
      .post(`/pur/receipts/${receiptId}/return`)
      .set(h)
      .send({
        documentDate: docDate,
        reason: 'Ledger 328 test return after invoice',
        notes: 'Return should succeed',
        supplierCreditNoteId: creditNoteId,
        lines: [{ receiptLineId, quantity: '1' }],
      })
      .expect(201);

    // ---- Query ledger for 328 ----
    const ledgerRes = await request(httpServer)
      .get(`/acc/reports/ledger?accountCode=328`)
      .set(h)
      .expect(200);

    expect(ledgerRes.body.account).toBeTruthy();
    expect(ledgerRes.body.account.code).toBe('328');
    expect(Array.isArray(ledgerRes.body.rows)).toBe(true);

    const rows = ledgerRes.body.rows;

    // We expect at least one debit (PurchaseReturn Dr 328) and at least one credit (SCN clearing Cr 328)
    const hasDebit328 = rows.some((r: any) => Number(r?.line?.debit ?? 0) > 0);
    const hasCredit328 = rows.some((r: any) => Number(r?.line?.credit ?? 0) > 0);

    expect(hasDebit328).toBe(true);
    expect(hasCredit328).toBe(true);
  });
});
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/modules/app/app.module';

describe('Purchasing: Multi-currency accounting (e2e)', () => {
  async function getJEsBySource(httpServer: any, h: any, sourceType: string, sourceId: string) {
    const res = await request(httpServer)
      .get(
        `/acc/journals/by-source?sourceType=${encodeURIComponent(sourceType)}&sourceId=${encodeURIComponent(sourceId)}`,
      )
      .set(h)
      .expect(200);
    return res.body;
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

  it('GRN GRNI posting uses base TRY for debit/credit with document currency in amountCurrency', async () => {
    // Setup: warehouse, unit, supplier, product
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
          name: 'E2E Multicurrency Supplier',
          email: 'supplier.mc@example.com',
          isActive: true,
          defaultCurrencyCode: 'USD',
        })
        .expect(201);
      supplierId = supCreate.body.id;
    }
    expect(supplierId).toBeTruthy();

    const prodRes = await request(httpServer).get('/md/products').set(h).expect(200);
    let productId = prodRes.body[0]?.id;
    if (!productId) {
      const prodCreate = await request(httpServer)
        .post('/md/products')
        .set(h)
        .send({
          sku: 'E2E-MC-001',
          name: 'E2E Multicurrency Product',
          type: 'GOODS',
          baseUnitId: pcsId,
          vatCode: 'KDV_20',
          isActive: true,
        })
        .expect(201);
      productId = prodCreate.body.id;
    }
    expect(productId).toBeTruthy();

    // Create PO in USD with exchangeRateToBase = 30
    // Line: qty=10, unitPrice=5 => lineSubtotal=50 USD
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

    // Approve PO
    await request(httpServer).post(`/pur/pos/${poId}/approve`).set(h).send({}).expect(201);

    // Receive GRN for full quantity (10)
    const grnRes = await request(httpServer)
      .post(`/pur/pos/${poId}/receive`)
      .set(h)
      .send({ lines: [{ poLineId, quantity: '10' }] })
      .expect(201);

    const receiptId = grnRes.body.receiptId;

    // Query JEs by source
    const jes = await getJEsBySource(httpServer, h, 'PurchaseReceipt', receiptId);
    expect(Array.isArray(jes)).toBe(true);
    expect(jes.length).toBe(1);

    const je = jes[0];
    expect(je.lines).toBeDefined();
    expect(je.lines.length).toBe(2);

    // Find Inventory (150) and GRNI (327) lines
    const invLine = je.lines.find((ln: any) => ln.account?.code === '150');
    const grniLine = je.lines.find((ln: any) => ln.account?.code === '327');

    expect(invLine).toBeDefined();
    expect(grniLine).toBeDefined();

    // Expected: 50 USD * 30 = 1500 TRY
    const expectedBaseTry = 1500.0;
    const expectedDocUsd = 50.0;

    // Inventory line: Dr 1500.00 TRY
    expect(Number(invLine.debit)).toBe(expectedBaseTry);
    expect(Number(invLine.credit)).toBe(0);
    expect(invLine.currencyCode).toBe('USD');
    expect(Number(invLine.amountCurrency)).toBe(expectedDocUsd);

    // GRNI line: Cr 1500.00 TRY
    expect(Number(grniLine.debit)).toBe(0);
    expect(Number(grniLine.credit)).toBe(expectedBaseTry);
    expect(grniLine.currencyCode).toBe('USD');
    expect(Number(grniLine.amountCurrency)).toBe(expectedDocUsd);
  });

  it('Supplier Invoice posting uses base TRY for debit/credit with document currency in amountCurrency', async () => {
    // Setup: warehouse, unit, supplier, product (reuse from previous test if available)
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
          name: 'E2E Invoice Supplier',
          email: 'supplier.inv@example.com',
          isActive: true,
          defaultCurrencyCode: 'USD',
        })
        .expect(201);
      supplierId = supCreate.body.id;
    }
    expect(supplierId).toBeTruthy();

    const prodRes = await request(httpServer).get('/md/products').set(h).expect(200);
    let productId = prodRes.body[0]?.id;
    if (!productId) {
      const prodCreate = await request(httpServer)
        .post('/md/products')
        .set(h)
        .send({
          sku: 'E2E-INV-001',
          name: 'E2E Invoice Product',
          type: 'GOODS',
          baseUnitId: pcsId,
          vatCode: 'KDV_20',
          isActive: true,
        })
        .expect(201);
      productId = prodCreate.body.id;
    }
    expect(productId).toBeTruthy();

    // Create PO in USD with exchangeRateToBase = 30
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

    // Receive GRN
    const grnRes = await request(httpServer)
      .post(`/pur/pos/${poId}/receive`)
      .set(h)
      .send({ lines: [{ poLineId, quantity: '10' }] })
      .expect(201);

    // Create and post invoice
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
        notes: 'Invoice for multicurrency test',
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

    // Post the invoice
    await request(httpServer).post(`/pur/invoices/${invoiceId}/post`).set(h).send({}).expect(201);

    // Query JEs by source
    const jes = await getJEsBySource(httpServer, h, 'SupplierInvoice', invoiceId);
    expect(Array.isArray(jes)).toBe(true);
    expect(jes.length).toBe(1);

    const je = jes[0];
    expect(je.lines).toBeDefined();
    expect(je.lines.length).toBe(3); // GRNI, VAT, AP

    // Expected values:
    // Net: 50 USD * 30 = 1500 TRY (doc: 50 USD)
    // VAT (20%): 10 USD * 30 = 300 TRY (doc: 10 USD)
    // Total: 60 USD * 30 = 1800 TRY (doc: 60 USD)

    const grniLine = je.lines.find((ln: any) => ln.account?.code === '327');
    const vatLine = je.lines.find((ln: any) => ln.account?.code === '191');
    const apLine = je.lines.find((ln: any) => ln.account?.code === '320');

    expect(grniLine).toBeDefined();
    expect(vatLine).toBeDefined();
    expect(apLine).toBeDefined();

    // GRNI line: Dr 1500.00 TRY
    expect(Number(grniLine.debit)).toBe(1500.0);
    expect(Number(grniLine.credit)).toBe(0);
    expect(grniLine.currencyCode).toBe('USD');
    expect(Number(grniLine.amountCurrency)).toBe(50.0);

    // VAT line: Dr 300.00 TRY
    expect(Number(vatLine.debit)).toBe(300.0);
    expect(Number(vatLine.credit)).toBe(0);
    expect(vatLine.currencyCode).toBe('USD');
    expect(Number(vatLine.amountCurrency)).toBe(10.0);

    // AP line: Cr 1800.00 TRY
    expect(Number(apLine.debit)).toBe(0);
    expect(Number(apLine.credit)).toBe(1800.0);
    expect(apLine.currencyCode).toBe('USD');
    expect(Number(apLine.amountCurrency)).toBe(60.0);
  });
});

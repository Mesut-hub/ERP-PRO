import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/modules/app/app.module';

describe('Purchasing: Base Currency (TRY) Accounting (e2e)', () => {
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

  it('USD PO receipt creates GRNI JE with base TRY amounts (1500.00) and USD currency/amountCurrency (50.00)', async () => {
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
          name: 'USD Supplier',
          email: 'usd.supplier@example.com',
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
          sku: 'USD-PRODUCT-001',
          name: 'USD Test Product',
          type: 'GOODS',
          baseUnitId: pcsId,
          vatCode: 'KDV_20',
          isActive: true,
        })
        .expect(201);
      productId = prodCreate.body.id;
    }
    expect(productId).toBeTruthy();

    // Create USD PO with exchangeRateToBase = 30
    // 5 units @ $10 each = $50 net
    const poRes = await request(httpServer)
      .post('/pur/pos')
      .set(h)
      .send({
        supplierId,
        warehouseId: whId,
        currencyCode: 'USD',
        exchangeRateToBase: '30',
        lines: [{ productId, unitId: pcsId, quantity: '5', unitPrice: '10', vatCode: 'KDV_20' }],
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
      .send({ lines: [{ poLineId, quantity: '5' }] })
      .expect(201);

    const receiptId = grnRes.body.receiptId;
    expect(receiptId).toBeTruthy();

    // Fetch journal entries for this receipt
    const jes = await getJEsBySource(httpServer, h, 'PurchaseReceipt', receiptId);
    expect(jes.length).toBeGreaterThanOrEqual(1);

    // Find the GRNI accrual JE
    const grniJe = jes.find((je: any) => 
      je.lines?.some((ln: any) => ln.account?.code === '150') &&
      je.lines?.some((ln: any) => ln.account?.code === '327')
    );
    expect(grniJe).toBeTruthy();

    // Verify both lines exist
    const line150 = grniJe.lines?.find((ln: any) => ln.account?.code === '150');
    const line327 = grniJe.lines?.find((ln: any) => ln.account?.code === '327');

    expect(line150).toBeTruthy();
    expect(line327).toBeTruthy();

    // Expected: net = 50 USD, rate = 30, base = 1500.00 TRY
    // Line 150 (Inventory): Dr 1500.00 TRY, amountCurrency 50.00 USD
    expect(Number(line150.debit)).toBe(1500.00);
    expect(Number(line150.credit)).toBe(0);
    expect(line150.currencyCode).toBe('USD');
    expect(Number(line150.amountCurrency)).toBe(50.00);

    // Line 327 (GRNI): Cr 1500.00 TRY, amountCurrency 50.00 USD
    expect(Number(line327.debit)).toBe(0);
    expect(Number(line327.credit)).toBe(1500.00);
    expect(line327.currencyCode).toBe('USD');
    expect(Number(line327.amountCurrency)).toBe(50.00);
  });

  it('USD supplier invoice creates JE with base TRY amounts and USD currency/amountCurrency', async () => {
    // Reuse setup from previous test
    const whRes = await request(httpServer).get('/inv/warehouses').set(h).expect(200);
    const whId = whRes.body.find((w: any) => w.code === 'MAIN')?.id;
    expect(whId).toBeTruthy();

    const unitRes = await request(httpServer).get('/md/units').set(h).expect(200);
    const pcsId = unitRes.body.find((u: any) => u.code === 'PCS')?.id;
    expect(pcsId).toBeTruthy();

    const supRes = await request(httpServer).get('/md/parties?type=SUPPLIER').set(h).expect(200);
    const supplierId = supRes.body[0]?.id;
    expect(supplierId).toBeTruthy();

    const prodRes = await request(httpServer).get('/md/products').set(h).expect(200);
    const productId = prodRes.body[0]?.id;
    expect(productId).toBeTruthy();

    // Create USD PO with exchangeRateToBase = 30
    const poRes = await request(httpServer)
      .post('/pur/pos')
      .set(h)
      .send({
        supplierId,
        warehouseId: whId,
        currencyCode: 'USD',
        exchangeRateToBase: '30',
        lines: [{ productId, unitId: pcsId, quantity: '5', unitPrice: '10', vatCode: 'KDV_20' }],
      })
      .expect(201);

    const poId = poRes.body.id;
    const poLineId = poRes.body.lines[0].id;

    await request(httpServer).post(`/pur/pos/${poId}/approve`).set(h).send({}).expect(201);

    // Receive PO
    await request(httpServer)
      .post(`/pur/pos/${poId}/receive`)
      .set(h)
      .send({ lines: [{ poLineId, quantity: '5' }] })
      .expect(201);

    // Create and post supplier invoice
    // Net: 50 USD @ rate 30 = 1500 TRY
    // VAT (20%): 10 USD @ rate 30 = 300 TRY
    // Total: 60 USD @ rate 30 = 1800 TRY
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
        notes: 'Base currency test invoice',
        lines: [
          {
            poLineId,
            productId,
            description: 'Invoice line',
            quantity: '5',
            unitPrice: '10',
            vatCode: 'KDV_20',
          },
        ],
      })
      .expect(201);

    const invoiceId = invRes.body.id;
    await request(httpServer).post(`/pur/invoices/${invoiceId}/post`).set(h).send({}).expect(201);

    // Fetch journal entries for this invoice
    const jes = await getJEsBySource(httpServer, h, 'SupplierInvoice', invoiceId);
    expect(jes.length).toBeGreaterThanOrEqual(1);

    // Find the main invoice JE (should have 327, 191, 320)
    const invJe = jes.find((je: any) =>
      je.lines?.some((ln: any) => ln.account?.code === '327') &&
      je.lines?.some((ln: any) => ln.account?.code === '191') &&
      je.lines?.some((ln: any) => ln.account?.code === '320')
    );
    expect(invJe).toBeTruthy();

    // Verify lines
    const line327 = invJe.lines?.find((ln: any) => ln.account?.code === '327'); // GRNI
    const line191 = invJe.lines?.find((ln: any) => ln.account?.code === '191'); // VAT
    const line320 = invJe.lines?.find((ln: any) => ln.account?.code === '320'); // AP

    expect(line327).toBeTruthy();
    expect(line191).toBeTruthy();
    expect(line320).toBeTruthy();

    // Line 327 (GRNI clearing): Dr 1500.00 TRY, amountCurrency 50.00 USD
    expect(Number(line327.debit)).toBe(1500.00);
    expect(Number(line327.credit)).toBe(0);
    expect(line327.currencyCode).toBe('USD');
    expect(Number(line327.amountCurrency)).toBe(50.00);

    // Line 191 (VAT): Dr 300.00 TRY, amountCurrency 10.00 USD
    expect(Number(line191.debit)).toBe(300.00);
    expect(Number(line191.credit)).toBe(0);
    expect(line191.currencyCode).toBe('USD');
    expect(Number(line191.amountCurrency)).toBe(10.00);

    // Line 320 (AP): Cr 1800.00 TRY, amountCurrency 60.00 USD
    expect(Number(line320.debit)).toBe(0);
    expect(Number(line320.credit)).toBe(1800.00);
    expect(line320.currencyCode).toBe('USD');
    expect(Number(line320.amountCurrency)).toBe(60.00);
  });

  it('USD unmatched supplier invoice (expense model) creates JE with base TRY amounts', async () => {
    // Unmatched invoice (no PO) uses expense model: 770/191/320
    const supRes = await request(httpServer).get('/md/parties?type=SUPPLIER').set(h).expect(200);
    const supplierId = supRes.body[0]?.id;
    expect(supplierId).toBeTruthy();

    const unitRes = await request(httpServer).get('/md/units').set(h).expect(200);
    const pcsId = unitRes.body.find((u: any) => u.code === 'PCS')?.id;
    expect(pcsId).toBeTruthy();

    const prodRes = await request(httpServer).get('/md/products').set(h).expect(200);
    const productId = prodRes.body[0]?.id;
    expect(productId).toBeTruthy();

    // Create unmatched invoice (no poId)
    // Net: 100 USD @ rate 25 = 2500 TRY
    // VAT (20%): 20 USD @ rate 25 = 500 TRY
    // Total: 120 USD @ rate 25 = 3000 TRY
    const invDate = new Date().toISOString();
    const invRes = await request(httpServer)
      .post('/pur/invoices')
      .set(h)
      .send({
        supplierId,
        currencyCode: 'USD',
        exchangeRateToBase: '25',
        documentDate: invDate,
        notes: 'Unmatched USD invoice',
        lines: [
          {
            productId,
            description: 'Service expense',
            quantity: '1',
            unitPrice: '100',
            vatCode: 'KDV_20',
          },
        ],
      })
      .expect(201);

    const invoiceId = invRes.body.id;
    await request(httpServer).post(`/pur/invoices/${invoiceId}/post`).set(h).send({}).expect(201);

    // Fetch journal entries
    const jes = await getJEsBySource(httpServer, h, 'SupplierInvoice', invoiceId);
    expect(jes.length).toBeGreaterThanOrEqual(1);

    // Find the main invoice JE (should have 770, 191, 320)
    const invJe = jes.find((je: any) =>
      je.lines?.some((ln: any) => ln.account?.code === '770') &&
      je.lines?.some((ln: any) => ln.account?.code === '191') &&
      je.lines?.some((ln: any) => ln.account?.code === '320')
    );
    expect(invJe).toBeTruthy();

    const line770 = invJe.lines?.find((ln: any) => ln.account?.code === '770'); // Expense
    const line191 = invJe.lines?.find((ln: any) => ln.account?.code === '191'); // VAT
    const line320 = invJe.lines?.find((ln: any) => ln.account?.code === '320'); // AP

    expect(line770).toBeTruthy();
    expect(line191).toBeTruthy();
    expect(line320).toBeTruthy();

    // Line 770 (Expense): Dr 2500.00 TRY, amountCurrency 100.00 USD
    expect(Number(line770.debit)).toBe(2500.00);
    expect(Number(line770.credit)).toBe(0);
    expect(line770.currencyCode).toBe('USD');
    expect(Number(line770.amountCurrency)).toBe(100.00);

    // Line 191 (VAT): Dr 500.00 TRY, amountCurrency 20.00 USD
    expect(Number(line191.debit)).toBe(500.00);
    expect(Number(line191.credit)).toBe(0);
    expect(line191.currencyCode).toBe('USD');
    expect(Number(line191.amountCurrency)).toBe(20.00);

    // Line 320 (AP): Cr 3000.00 TRY, amountCurrency 120.00 USD
    expect(Number(line320.debit)).toBe(0);
    expect(Number(line320.credit)).toBe(3000.00);
    expect(line320.currencyCode).toBe('USD');
    expect(Number(line320.amountCurrency)).toBe(120.00);
  });

  it('TRY invoice remains unchanged (rate = 1)', async () => {
    // Test that TRY invoices continue to work with rate = 1
    const supRes = await request(httpServer).get('/md/parties?type=SUPPLIER').set(h).expect(200);
    const supplierId = supRes.body[0]?.id;
    expect(supplierId).toBeTruthy();

    const prodRes = await request(httpServer).get('/md/products').set(h).expect(200);
    const productId = prodRes.body[0]?.id;
    expect(productId).toBeTruthy();

    // Create TRY invoice (no explicit rate, should default to 1)
    const invDate = new Date().toISOString();
    const invRes = await request(httpServer)
      .post('/pur/invoices')
      .set(h)
      .send({
        supplierId,
        currencyCode: 'TRY',
        documentDate: invDate,
        notes: 'TRY invoice',
        lines: [
          {
            productId,
            description: 'TRY expense',
            quantity: '1',
            unitPrice: '100',
            vatCode: 'KDV_20',
          },
        ],
      })
      .expect(201);

    const invoiceId = invRes.body.id;
    await request(httpServer).post(`/pur/invoices/${invoiceId}/post`).set(h).send({}).expect(201);

    const jes = await getJEsBySource(httpServer, h, 'SupplierInvoice', invoiceId);
    expect(jes.length).toBeGreaterThanOrEqual(1);

    const invJe = jes.find((je: any) =>
      je.lines?.some((ln: any) => ln.account?.code === '770')
    );
    expect(invJe).toBeTruthy();

    const line770 = invJe.lines?.find((ln: any) => ln.account?.code === '770');
    expect(line770).toBeTruthy();

    // Line 770: Dr 100.00 TRY, amountCurrency 100.00 TRY
    expect(Number(line770.debit)).toBe(100.00);
    expect(line770.currencyCode).toBe('TRY');
    expect(Number(line770.amountCurrency)).toBe(100.00);
  });
});

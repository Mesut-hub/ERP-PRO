import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/modules/app/app.module';

describe('Purchasing: invoice -> SCN -> purchase return (e2e)', () => {
  async function getJEsBySource(httpServer: any, h: any, sourceType: string, sourceId: string) {
    const res = await request(httpServer)
      .get(
        `/acc/journals/by-source?sourceType=${encodeURIComponent(sourceType)}&sourceId=${encodeURIComponent(sourceId)}`,
      )
      .set(h)
      .expect(200);
    return res.body;
  }

  function jeHasAccountCode(jes: any[], code: string) {
    return jes.some((je) => (je.lines ?? []).some((ln: any) => ln.account?.code === code));
  }

  function jeHasAnyLine(jes: any[], predicate: (ln: any) => boolean) {
    return jes.some((je) => (je.lines ?? []).some((ln: any) => predicate(ln)));
  }
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

    const receiptRes = await request(httpServer)
      .get(`/pur/receipts/${receiptId}`)
      .set(h)
      .expect(200);
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

    const invJes = await getJEsBySource(httpServer, h, 'SupplierInvoice', invoiceId);
    expect(Array.isArray(invJes)).toBe(true);
    expect(invJes.length).toBeGreaterThan(0);
    expect(jeHasAccountCode(invJes, '320')).toBe(true);

    // NEW: verify journalEntry relation is stored on invoice
    const invGet = await request(httpServer).get(`/pur/invoices/${invoiceId}`).set(h).expect(200);
    expect(invGet.body.journalEntry).toBeTruthy();
    expect(invGet.body.journalEntry.id).toBeTruthy();

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
            poLineId,
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
    await request(httpServer)
      .post(`/pur/invoices/${creditNoteId}/post`)
      .set(h)
      .send({})
      .expect(201);

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

    const purchaseReturnId = okReturn.body.purchaseReturnId;

    // NEW: verify SCN produced a clearing JE with account 328 (Dr327/Cr328)
    const scnJes = await getJEsBySource(httpServer, h, 'SupplierInvoice', creditNoteId);
    expect(scnJes.length).toBeGreaterThan(0);

    const scnPostingJe = scnJes.find(
      (je: any) =>
        typeof je.description === 'string' &&
        je.description.includes('Supplier invoice') &&
        je.description.includes('posting'),
    );
    expect(scnPostingJe).toBeTruthy();

    expect(
      (scnPostingJe.lines ?? []).some(
        (ln: any) => ln.account?.code === '320' && Number(ln.debit) > 0,
      ),
    ).toBe(true);

    // NEW: posting JE must hit GRNI 327 (not expense 770) for PO-matched notes
    expect((scnPostingJe.lines ?? []).some((ln: any) => ln.account?.code === '327')).toBe(true);

    expect((scnPostingJe.lines ?? []).some((ln: any) => ln.account?.code === '770')).toBe(false);

    expect(jeHasAccountCode(scnJes, '328')).toBe(true);
    expect(jeHasAccountCode(scnJes, '327')).toBe(true);

    const scnGet = await request(httpServer)
      .get(`/pur/invoices/${creditNoteId}`)
      .set(h)
      .expect(200);
    expect(scnGet.body.journalEntry).toBeTruthy();

    // Stronger: verify 328 is credited (clearing)
    expect(jeHasAnyLine(scnJes, (ln) => ln.account?.code === '328' && Number(ln.credit) > 0)).toBe(
      true,
    );

    // NEW: verify PurchaseReturn JE exists and uses 328 and 150
    const prJes = await getJEsBySource(httpServer, h, 'PurchaseReturn', purchaseReturnId);
    expect(prJes.length).toBeGreaterThan(0);
    expect(jeHasAccountCode(prJes, '328')).toBe(true); // Dr 328
    expect(jeHasAccountCode(prJes, '150')).toBe(true); // Cr 150

    // Stronger: check at least one line credits 150 and one line debits 328
    expect(jeHasAnyLine(prJes, (ln) => ln.account?.code === '150' && Number(ln.credit) > 0)).toBe(
      true,
    );
    expect(jeHasAnyLine(prJes, (ln) => ln.account?.code === '328' && Number(ln.debit) > 0)).toBe(
      true,
    );
  });
});

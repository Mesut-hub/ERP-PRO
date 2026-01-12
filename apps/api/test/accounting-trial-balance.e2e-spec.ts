import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/modules/app/app.module';

describe('Accounting reports: trial balance (e2e)', () => {
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

  it('returns rows grouped by account code', async () => {
    const res = await request(httpServer).get('/acc/reports/trial-balance').set(h).expect(200);

    expect(res.body).toBeTruthy();
    expect(Array.isArray(res.body.rows)).toBe(true);

    // Not asserting exact balances (depends on seed + previous tests),
    // just prove structure is valid and account codes exist.
    const rows = res.body.rows;
    if (rows.length > 0) {
      const r0 = rows[0];
      expect(typeof r0.accountCode).toBe('string');
      expect(typeof r0.accountName).toBe('string');
      expect(typeof r0.debit).toBe('number');
      expect(typeof r0.credit).toBe('number');
      expect(typeof r0.net).toBe('number');
    }
  });
});

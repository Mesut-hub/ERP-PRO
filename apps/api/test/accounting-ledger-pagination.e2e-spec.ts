import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/modules/app/app.module';

describe('Accounting reports: ledger pagination (e2e)', () => {
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

  it('respects take/skip and returns meta.total', async () => {
    const res = await request(httpServer)
      .get('/acc/reports/ledger?accountCode=328&take=1&skip=0')
      .set(h)
      .expect(200);

    expect(res.body.meta).toBeTruthy();
    expect(res.body.meta.take).toBe(1);
    expect(res.body.meta.skip).toBe(0);
    expect(typeof res.body.meta.total).toBe('number');

    // rows can be 0 if no activity yet in account 328 in this suite run, but if it exists, must be <= take
    expect(Array.isArray(res.body.rows)).toBe(true);
    expect(res.body.rows.length).toBeLessThanOrEqual(1);
  });
});
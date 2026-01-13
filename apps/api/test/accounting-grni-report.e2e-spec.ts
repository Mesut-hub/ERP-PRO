import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/modules/app/app.module';

describe('Accounting reports: GRNI report (e2e)', () => {
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

  it('returns GRNI rows grouped by supplier', async () => {
    const res = await request(httpServer).get('/acc/reports/grni').set(h).expect(200);

    expect(res.body).toBeTruthy();
    expect(res.body.account).toBeTruthy();
    expect(res.body.account.code).toBe('327');
    expect(Array.isArray(res.body.rows)).toBe(true);

    if (res.body.rows.length > 0) {
      const r0 = res.body.rows[0];
      expect('debit' in r0).toBe(true);
      expect('credit' in r0).toBe(true);
      expect('net' in r0).toBe(true);
    }
  });
});
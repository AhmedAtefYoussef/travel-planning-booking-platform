import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './support/create-test-app';

describe('GET /api/health (e2e): TRVL-128', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('is public and reports the database and replica set', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      db: 'up',
      replicaSet: expect.any(String),
    });
    expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});

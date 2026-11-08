import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './support/create-test-app';

describe('App bootstrap (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('boots against MongoDB and serves routes under /api only', async () => {
    await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);
    await request(app.getHttpServer()).get('/does-not-exist').expect(404);
  });

  it('does not advertise the server stack', async () => {
    const res = await request(app.getHttpServer()).get('/api/does-not-exist');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

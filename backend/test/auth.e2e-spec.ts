import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DEV_IDS } from '../src/common/auth/auth-stub.guard';
import { createTestApp } from './support/create-test-app';
import { AuthProbeModule } from './support/auth-probe.module';

const HOTEL = '6730c5f1e4b0a1b2c3d4e5aa';
const OWNER = '6730c5f1e4b0a1b2c3d4e5f6';

describe('Auth contract (e2e): TRVL-131, GEN-13, ACC-11', () => {
  let app: INestApplication<App>;
  const get = (path: string, devUser?: string) => {
    const req = request(app.getHttpServer()).get(path);
    return devUser ? req.set('x-dev-user', devUser) : req;
  };

  beforeAll(async () => {
    app = await createTestApp([AuthProbeModule]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets guests call @Public() routes', async () => {
    await get('/api/__auth/public').expect(200, { ok: true });
    await get('/api/health').expect(200);
  });

  it('protects every other route by default (401 without a caller)', async () => {
    for (const path of [
      '/api/__auth/implicit',
      '/api/__auth/any',
      '/api/__auth/admin',
    ]) {
      const res = await get(path).expect(401);
      expect(res.body).toMatchObject({
        statusCode: 401,
        code: 'UNAUTHENTICATED',
      });
    }
  });

  it('rejects a malformed stub header with 401', async () => {
    const res = await get('/api/__auth/any', 'ROOT').expect(401);
    expect(res.body.message).toMatch(/Malformed x-dev-user/);
  });

  it('exposes the caller through @CurrentUser()', async () => {
    const res = await get('/api/__auth/any', `USER:${OWNER}`).expect(200);
    expect(res.body).toEqual({ id: OWNER, role: 'USER' });
    const mod = await get(
      '/api/__auth/implicit',
      `HOTEL_MODERATOR:${OWNER}:${HOTEL}`,
    ).expect(200);
    expect(mod.body).toEqual({
      id: OWNER,
      role: 'HOTEL_MODERATOR',
      assignedProvider: { type: 'HOTEL', providerId: HOTEL },
    });
  });

  it('enforces roles with 403', async () => {
    await get('/api/__auth/admin', 'ADMIN').expect(200);
    const res = await get('/api/__auth/admin', 'USER').expect(403);
    expect(res.body).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('applies controller-level roles and lets method-level @Public() override them', async () => {
    await get('/api/__auth/admin-area', 'ADMIN').expect(200);
    await get('/api/__auth/admin-area', 'HOTEL_MODERATOR').expect(403);
    await get('/api/__auth/admin-area/open').expect(200);
  });

  it('enforces ownership: owners and admins only (ACC-11)', async () => {
    await get(`/api/__auth/bookings/${OWNER}`, `USER:${OWNER}`).expect(200);
    await get(`/api/__auth/bookings/${OWNER}`, `USER:${DEV_IDS.USER}`).expect(
      403,
    );
    await get(`/api/__auth/bookings/${OWNER}`, 'ADMIN').expect(200);
  });

  it('enforces moderator provider scope', async () => {
    await get(
      `/api/__auth/hotels/${HOTEL}/rooms`,
      `HOTEL_MODERATOR:${OWNER}:${HOTEL}`,
    ).expect(200);
    await get(
      `/api/__auth/hotels/${DEV_IDS.provider}/rooms`,
      `HOTEL_MODERATOR:${OWNER}:${HOTEL}`,
    ).expect(403);
    await get(`/api/__auth/hotels/${HOTEL}/rooms`, 'AIRLINE_MODERATOR').expect(
      403,
    );
  });
});

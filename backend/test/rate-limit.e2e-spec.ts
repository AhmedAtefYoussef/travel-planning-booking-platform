import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  CREDENTIALS_RATE_LIMIT,
  DEFAULT_RATE_LIMIT,
} from '../src/common/security/rate-limit';
import { createTestApp } from './support/create-test-app';

/**
 * ADR-0007 (TRVL-183): per-IP rate limits. Off in the test environment by default, so this suite turns
 * them on for its own app and restores the setting afterwards.
 */
describe('Rate limiting (e2e): per-IP limits on credentials, payments and the API', () => {
  let app: INestApplication<App>;
  const previous = process.env.RATE_LIMIT_ENABLED;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = 'true';
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    if (previous === undefined) delete process.env.RATE_LIMIT_ENABLED;
    else process.env.RATE_LIMIT_ENABLED = previous;
  });

  const login = () =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'WrongPass1' });

  it('refuses the 11th login in a minute with 429 TOO_MANY_REQUESTS and a Retry-After', async () => {
    for (let i = 0; i < CREDENTIALS_RATE_LIMIT; i += 1) {
      await login().expect(401);
    }
    const res = await login().expect(429);
    expect(res.body).toMatchObject({
      statusCode: 429,
      code: 'TOO_MANY_REQUESTS',
    });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(60);
  });

  it('ignores X-Forwarded-For unless TRUST_PROXY is set, so a client cannot pick a fresh address', async () => {
    await login().set('X-Forwarded-For', '203.0.113.7').expect(429);
  });

  it('counts each endpoint separately: registration still answers after login is exhausted', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({})
      .expect(400);
  });

  it('never limits the Stripe webhook', async () => {
    for (let i = 0; i < CREDENTIALS_RATE_LIMIT * 3; i += 1) {
      await request(app.getHttpServer())
        .post('/api/payments/webhook')
        .set('Stripe-Signature', 't=1,v1=bad')
        .send({})
        .expect(400);
    }
  });

  it(`allows ${DEFAULT_RATE_LIMIT} other requests a minute, then answers 429`, async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < DEFAULT_RATE_LIMIT; i += 1) {
      await request(server).get('/api/countries').expect(200);
    }
    await request(server).get('/api/countries').expect(429);
    // The health probe is exempt even then.
    await request(server).get('/api/health').expect(200);
  });
});

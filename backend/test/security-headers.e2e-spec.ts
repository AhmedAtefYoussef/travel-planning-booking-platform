import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { setupSwagger } from '../src/common/swagger/swagger.setup';

/**
 * GEN-13: the API sends standard security headers (helmet) on every response, and its Content Security
 * Policy still lets Swagger UI, the Milestone 1 evaluation surface, load its same-origin scripts.
 */
describe('Security headers (e2e): GEN-13 helmet on every response', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    // Same order as main.ts: Swagger is mounted before init, ahead of Nest's not-found handler.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<INestApplication<App>>({
      rawBody: true,
      logger: false,
    });
    configureApp(app);
    setupSwagger(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sends helmet headers on an API response, and no x-powered-by', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toContain('max-age=');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['x-powered-by']).toBeUndefined();
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('serves Swagger UI with scripts that the policy allows (same origin, no inline script)', async () => {
    const page = await request(app.getHttpServer())
      .get('/api/docs/')
      .expect(200);
    expect(page.headers['content-type']).toContain('text/html');
    const scripts = [
      ...page.text.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g),
    ];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attrs, body] of scripts) {
      expect(attrs).toMatch(/src="(?!https?:)/);
      expect(body.trim()).toBe('');
    }
    await request(app.getHttpServer())
      .get('/api/docs/swagger-ui-init.js')
      .expect(200);
  });
});

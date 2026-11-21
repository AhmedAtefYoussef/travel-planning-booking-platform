import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { diagnosticsEnabled } from '../src/modules/diagnostics';
import { createTestApp } from './support/create-test-app';

/** The Swagger demo endpoints behave exactly as the GEN-02, GEN-05 and GEN-13 criteria require. */
describe('Diagnostics (dev-only Swagger demos, e2e): GEN-02, GEN-05, GEN-13', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('is never enabled in production', () => {
    expect(diagnosticsEnabled('production')).toBe(false);
    expect(diagnosticsEnabled(undefined)).toBe(false);
    expect(diagnosticsEnabled('development')).toBe(true);
    expect(diagnosticsEnabled('test')).toBe(true);
  });

  describe('GEN-02 / GEN-13 validation', () => {
    it('returns one fieldError per problem, including unknown properties', async () => {
      const res = await http()
        .post('/api/diagnostics/validation')
        .send({
          contactEmail: 'not-an-email',
          passengers: [{ fullName: 'A', dob: '10/12/1990', type: 'PET' }],
          isAdmin: true,
        })
        .expect(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
      });
      const fields = res.body.fieldErrors.map(
        (f: { field: string }) => f.field,
      );
      expect(fields).toEqual(
        expect.arrayContaining([
          'isAdmin',
          'contactEmail',
          'passengers[0].fullName',
          'passengers[0].dob',
          'passengers[0].type',
        ]),
      );
    });

    it('accepts a valid payload', async () => {
      await http()
        .post('/api/diagnostics/validation')
        .send({
          contactEmail: 'traveller@example.com',
          passengers: [
            { fullName: 'Ada Lovelace', dob: '1990-12-10', type: 'ADULT' },
          ],
        })
        .expect(200, { valid: true, passengerCount: 1 });
    });
  });

  describe('GEN-05 pagination', () => {
    it('serves 10, 10 and 3 rows with a consistent envelope', async () => {
      const pages = await Promise.all(
        [1, 2, 3, 4].map((p) =>
          http().get(`/api/diagnostics/rows?page=${p}`).expect(200),
        ),
      );
      type PageBody = { items: { number: number }[] };
      const bodies = pages.map((r) => r.body as PageBody);
      expect(bodies.map((b) => b.items.length)).toEqual([10, 10, 3, 0]);
      for (const [i, r] of pages.entries()) {
        expect(r.body).toMatchObject({
          page: i + 1,
          limit: 10,
          total: 23,
          totalPages: 3,
        });
      }
      expect(pages[2].body.items[2]).toEqual({
        number: 23,
        label: 'Sample row 23',
      });
      const numbers = bodies.flatMap((b) => b.items.map((x) => x.number));
      expect(numbers).toEqual(Array.from({ length: 23 }, (_, i) => i + 1));
    });

    it.each(['page=0', 'page=abc', 'limit=50', 'pageSize=5', 'perPage=20'])(
      'rejects ?%s',
      async (qs) => {
        const res = await http().get(`/api/diagnostics/rows?${qs}`).expect(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
      },
    );
  });

  describe('GEN-02 persistence errors', () => {
    it('maps a duplicate key to 409 and reads records back', async () => {
      const key = `TRVL-E2E-${Date.now()}`;
      const created = await http()
        .post('/api/diagnostics/records')
        .send({ key })
        .expect(201);
      await http()
        .get(`/api/diagnostics/records/${created.body.id}`)
        .expect(200, created.body);
      const dup = await http()
        .post('/api/diagnostics/records')
        .send({ key })
        .expect(409);
      expect(dup.body).toMatchObject({
        code: 'DUPLICATE_KEY',
        fieldErrors: [{ field: 'key', message: 'key already exists' }],
      });
    });

    it('returns 400 INVALID_ID and 404 NOT_FOUND', async () => {
      const bad = await http().get('/api/diagnostics/records/123').expect(400);
      expect(bad.body.code).toBe('INVALID_ID');
      const missing = await http()
        .get('/api/diagnostics/records/0123456789abcdef01234567')
        .expect(404);
      expect(missing.body.code).toBe('NOT_FOUND');
    });
  });

  describe('GEN-13 passwords and authorisation', () => {
    it('shows salted hashes that verify and never contain the password', async () => {
      const res = await http()
        .post('/api/diagnostics/password-hash')
        .send({ password: 'Sup3r$ecret!' })
        .expect(200);
      expect(res.body).toMatchObject({
        saltsDiffer: true,
        bothVerify: true,
        wrongPasswordVerifies: false,
        containsPlainText: false,
        workFactor: 12,
      });
      expect(res.body.firstHash).not.toBe(res.body.secondHash);
    });

    it('requires a caller (401) and the right role (403)', async () => {
      await http().get('/api/diagnostics/whoami').expect(401);
      await http()
        .get('/api/diagnostics/whoami')
        .set('x-dev-user', 'USER')
        .expect(200, { id: '000000000000000000000001', role: 'USER' });
      const forbidden = await http()
        .get('/api/diagnostics/admin-only')
        .set('x-dev-user', 'USER')
        .expect(403);
      expect(forbidden.body.code).toBe('FORBIDDEN');
      await http()
        .get('/api/diagnostics/admin-only')
        .set('x-dev-user', 'ADMIN')
        .expect(200, { ok: true, role: 'ADMIN' });
    });
  });
});

/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BookingType } from '../src/common/contracts/booking.contract';
import { PAYABLE_BOOKING } from '../src/common/contracts/tokens';
import type { PayableBookingStub } from '../src/common/stubs/payable-booking.stub';
import { hash, verify } from '../src/common/security/password-hasher';
import {
  asAdmin,
  asUser,
  createTestApp,
  seedBooking,
  TestApp,
} from './utils/test-app';

jest.setTimeout(120_000);

describe('Foundation: validation, errors, auth, pagination (e2e)', () => {
  let t: TestApp;
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
    app = t.app;
  });
  afterAll(async () => {
    await t.close();
  });

  describe('GEN-02 / GEN-13 validation', () => {
    it('returns the standard error body with fieldErrors for a DTO failure', async () => {
      const b = seedBooking(
        app.get<PayableBookingStub>(PAYABLE_BOOKING),
        BookingType.FLIGHT,
      );
      const res = await http()
        .post(`/api/bookings/flight/${b.id}/accept-policies`)
        .set(asUser())
        .send({ accepted: 'yes' })
        .expect(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        error: expect.any(String),
        message: expect.anything(),
        path: expect.stringContaining('/accept-policies'),
      });
      expect(new Date(res.body.timestamp).getTime()).not.toBeNaN();
      expect(Array.isArray(res.body.fieldErrors)).toBe(true);
      expect(res.body.fieldErrors[0]).toEqual({
        field: 'accepted',
        message: expect.any(String),
      });
    });

    it('rejects unknown fields (whitelist + forbidNonWhitelisted)', async () => {
      const res = await http()
        .post('/api/payments')
        .set(asUser())
        .send({
          bookingType: 'FLIGHT',
          bookingId: 'a'.repeat(24),
          role: 'ADMIN',
        })
        .expect(400);
      expect(res.body.fieldErrors.map((f: any) => f.field)).toContain('role');
    });

    it('400s on a malformed ObjectId path param', async () => {
      const res = await http()
        .get('/api/payments/not-an-object-id')
        .set(asUser())
        .expect(400);
      expect(res.body.statusCode).toBe(400);
    });

    it('unknown routes use the same error body shape', async () => {
      const res = await http()
        .get('/api/no-such-route')
        .set(asUser())
        .expect(404);
      expect(res.body).toMatchObject({
        statusCode: 404,
        path: '/api/no-such-route',
      });
    });
  });

  describe('GEN-13 deny-by-default auth', () => {
    it('401 for protected routes without dev headers', async () => {
      await http().get('/api/admin/audit-logs').expect(401);
      await http()
        .get(`/api/payments/${'a'.repeat(24)}`)
        .expect(401);
    });

    it('@Public routes are open', async () => {
      await http().get('/api/currencies').expect(200);
    });

    it('rejects an unknown dev role', async () => {
      await http()
        .get('/api/admin/audit-logs')
        .set({ 'x-dev-user-id': 'a'.repeat(24), 'x-dev-role': 'SUPERUSER' })
        .expect(401);
    });

    it('enforces roles', async () => {
      await http().get('/api/admin/audit-logs').set(asUser()).expect(403);
      await http().get('/api/admin/audit-logs').set(asAdmin()).expect(200);
    });
  });

  describe('GEN-05 pagination', () => {
    it('returns the envelope with fixed limit 10', async () => {
      const res = await http()
        .get('/api/admin/audit-logs')
        .set(asAdmin())
        .expect(200);
      expect(res.body).toEqual({
        items: expect.any(Array),
        page: 1,
        limit: 10,
        total: expect.any(Number),
        totalPages: expect.any(Number),
      });
    });

    it.each(['0', 'x', '-1', '1.5'])('rejects page=%s with 400', async (p) => {
      await http()
        .get(`/api/admin/audit-logs?page=${p}`)
        .set(asAdmin())
        .expect(400);
    });

    it('ignores attempts to change page size', async () => {
      // Documented behaviour: `limit` is not a query parameter. The global
      // pipe forbids non-whitelisted fields, so limit != 10 is a 400.
      const res = await http()
        .get('/api/admin/audit-logs?page=1&limit=50')
        .set(asAdmin())
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('limit');
    });
  });

  describe('Swagger', () => {
    it('serves the UI and the JSON document', async () => {
      await http().get('/api/docs').redirects(1).expect(200);
      const res = await http().get('/api/docs-json').expect(200);
      expect(res.body.openapi).toBeDefined();
      expect(Object.keys(res.body.paths)).toEqual(
        expect.arrayContaining([expect.stringContaining('payments')]),
      );
    });
  });

  describe('GEN-13 password hashing helper', () => {
    it('hashes with a per-call salt and verifies', async () => {
      const a = await hash('S3cret-pass!');
      const b = await hash('S3cret-pass!');
      expect(a).not.toContain('S3cret-pass!');
      expect(a).toMatch(/^\$2[aby]\$/);
      expect(a).not.toBe(b);
      await expect(verify('S3cret-pass!', a)).resolves.toBe(true);
      await expect(verify('wrong', a)).resolves.toBe(false);
    });
  });
});

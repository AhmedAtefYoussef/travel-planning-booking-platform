import { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './support/create-test-app';

/** FLT-01: admins create airlines; only the assigned airline moderator edits one. */
describe('Airlines (e2e): FLT-01', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const admin = 'ADMIN';
  const moderatorOf = (airlineId: string) =>
    `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airlineId}`;

  let airlineId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/airlines', () => {
    it('an admin creates an airline: code stored in capitals, active, empty policy', async () => {
      const res = await http()
        .post('/api/airlines')
        .set('x-dev-user', admin)
        .send({
          name: 'EgyptAir',
          code: 'ms',
          logoUrl: 'https://cdn.example.com/ms.png',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'EgyptAir',
        code: 'MS',
        logoUrl: 'https://cdn.example.com/ms.png',
        isActive: true,
        policy: { cancellationTiers: [], extraBaggage: null },
      });
      expect(res.body.id).toMatch(/^[a-f0-9]{24}$/);
      airlineId = res.body.id;
    });

    it('rejects a duplicate code with 409', async () => {
      const res = await http()
        .post('/api/airlines')
        .set('x-dev-user', admin)
        .send({ name: 'Another', code: 'MS' })
        .expect(409);
      expect(res.body.code).toBe('DUPLICATE_KEY');
    });

    it('rejects invalid input with one field error per problem', async () => {
      const res = await http()
        .post('/api/airlines')
        .set('x-dev-user', admin)
        .send({
          name: 'E',
          code: 'EGYPT',
          logoUrl: 'not-a-url',
          isActive: false,
        })
        .expect(400);
      expect(
        res.body.fieldErrors.map((f: { field: string }) => f.field).sort(),
      ).toEqual(['code', 'isActive', 'logoUrl', 'name']);
    });

    it('only admins may create airlines', async () => {
      await http()
        .post('/api/airlines')
        .send({ name: 'X Air', code: 'XA' })
        .expect(401);
      await http()
        .post('/api/airlines')
        .set('x-dev-user', `USER:${new Types.ObjectId().toHexString()}`)
        .send({ name: 'X Air', code: 'XA' })
        .expect(403);
      await http()
        .post('/api/airlines')
        .set('x-dev-user', moderatorOf(new Types.ObjectId().toHexString()))
        .send({ name: 'X Air', code: 'XA' })
        .expect(403);
    });
  });

  describe('GET /api/airlines/:id', () => {
    it('is public', async () => {
      const res = await http().get(`/api/airlines/${airlineId}`).expect(200);
      expect(res.body).toMatchObject({ id: airlineId, code: 'MS' });
    });

    it('returns 404 for an unknown id and 400 for a malformed one', async () => {
      await http()
        .get(`/api/airlines/${new Types.ObjectId().toHexString()}`)
        .expect(404);
      const bad = await http().get('/api/airlines/not-an-id').expect(400);
      expect(bad.body.code).toBe('INVALID_ID');
    });
  });

  describe('PATCH /api/airlines/:id', () => {
    it("the assigned moderator edits the airline's name, code and logo", async () => {
      const res = await http()
        .patch(`/api/airlines/${airlineId}`)
        .set('x-dev-user', moderatorOf(airlineId))
        .send({
          name: 'EgyptAir Express',
          code: 'mx',
          logoUrl: 'https://cdn.example.com/mx.png',
        })
        .expect(200);
      expect(res.body).toMatchObject({
        name: 'EgyptAir Express',
        code: 'MX',
        logoUrl: 'https://cdn.example.com/mx.png',
      });
      const after = await http().get(`/api/airlines/${airlineId}`).expect(200);
      expect(after.body.name).toBe('EgyptAir Express');
    });

    it('a moderator of another airline gets 403 and nothing changes', async () => {
      const res = await http()
        .patch(`/api/airlines/${airlineId}`)
        .set('x-dev-user', moderatorOf(new Types.ObjectId().toHexString()))
        .send({ name: 'Hijacked' })
        .expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
      const after = await http().get(`/api/airlines/${airlineId}`).expect(200);
      expect(after.body.name).toBe('EgyptAir Express');
    });

    it('users and admins cannot edit (FLT-01 gives editing to the moderator)', async () => {
      await http()
        .patch(`/api/airlines/${airlineId}`)
        .set('x-dev-user', `USER:${new Types.ObjectId().toHexString()}`)
        .send({ name: 'x' })
        .expect(403);
      await http()
        .patch(`/api/airlines/${airlineId}`)
        .set('x-dev-user', admin)
        .send({ name: 'x' })
        .expect(403);
    });

    it('a code already used by another airline returns 409', async () => {
      const other = await http()
        .post('/api/airlines')
        .set('x-dev-user', admin)
        .send({ name: 'Emirates', code: 'EK' })
        .expect(201);
      await http()
        .patch(`/api/airlines/${other.body.id}`)
        .set('x-dev-user', moderatorOf(other.body.id))
        .send({ code: 'MX' })
        .expect(409);
    });

    it('rejects null for name and code; logoUrl null removes the logo', async () => {
      const res = await http()
        .patch(`/api/airlines/${airlineId}`)
        .set('x-dev-user', moderatorOf(airlineId))
        .send({ name: null, code: null })
        .expect(400);
      expect(
        [
          ...new Set(
            res.body.fieldErrors.map((f: { field: string }) => f.field),
          ),
        ].sort(),
      ).toEqual(['code', 'name']);
      await http()
        .patch(`/api/airlines/${airlineId}`)
        .set('x-dev-user', moderatorOf(airlineId))
        .send({ logoUrl: 'https://cdn.example.com/logos/x.png' })
        .expect(200);
      const cleared = await http()
        .patch(`/api/airlines/${airlineId}`)
        .set('x-dev-user', moderatorOf(airlineId))
        .send({ logoUrl: null })
        .expect(200);
      expect(cleared.body.logoUrl).toBeNull();
      expect(
        (await http().get(`/api/airlines/${airlineId}`).expect(200)).body
          .logoUrl,
      ).toBeNull();
    });

    it('rejects an empty edit and fields that cannot be edited here', async () => {
      await http()
        .patch(`/api/airlines/${airlineId}`)
        .set('x-dev-user', moderatorOf(airlineId))
        .send({})
        .expect(400);
      const res = await http()
        .patch(`/api/airlines/${airlineId}`)
        .set('x-dev-user', moderatorOf(airlineId))
        .send({ isActive: false })
        .expect(400);
      expect(res.body.fieldErrors[0].field).toBe('isActive');
    });
  });

  describe('PUT /api/airlines/:id/baggage-policy (FLT-08)', () => {
    it('the assigned moderator sets the price per extra bag and the per-passenger cap', async () => {
      const res = await http()
        .put(`/api/airlines/${airlineId}/baggage-policy`)
        .set('x-dev-user', moderatorOf(airlineId))
        .send({ pricePerBagMinor: 4000, maxExtraBagsPerPassenger: 2 })
        .expect(200);
      expect(res.body.policy.extraBaggage).toEqual({
        pricePerBagMinor: 4000,
        maxExtraBagsPerPassenger: 2,
      });
      const after = await http().get(`/api/airlines/${airlineId}`).expect(200);
      expect(after.body.policy.extraBaggage.maxExtraBagsPerPassenger).toBe(2);
    });

    it('rejects numbers too large to count exactly (1e20, 1e300) with field errors', async () => {
      for (const value of [1e20, 1e300]) {
        const res = await http()
          .put(`/api/airlines/${airlineId}/baggage-policy`)
          .set('x-dev-user', moderatorOf(airlineId))
          .send({ pricePerBagMinor: value, maxExtraBagsPerPassenger: value })
          .expect(400);
        expect(
          res.body.fieldErrors.map((f: { field: string }) => f.field).sort(),
        ).toEqual(['maxExtraBagsPerPassenger', 'pricePerBagMinor']);
      }
    });

    it('has no upper limit on extra bags per passenger (FLT-08 sets none)', async () => {
      const res = await http()
        .put(`/api/airlines/${airlineId}/baggage-policy`)
        .set('x-dev-user', moderatorOf(airlineId))
        .send({ pricePerBagMinor: 4000, maxExtraBagsPerPassenger: 25 })
        .expect(200);
      expect(res.body.policy.extraBaggage.maxExtraBagsPerPassenger).toBe(25);
    });

    it('replaces the policy; a cap of 0 means no extra bags', async () => {
      const res = await http()
        .put(`/api/airlines/${airlineId}/baggage-policy`)
        .set('x-dev-user', moderatorOf(airlineId))
        .send({ pricePerBagMinor: 5000, maxExtraBagsPerPassenger: 0 })
        .expect(200);
      expect(res.body.policy.extraBaggage).toEqual({
        pricePerBagMinor: 5000,
        maxExtraBagsPerPassenger: 0,
      });
    });

    it('rejects a price that is not > 0, a negative cap and fractions', async () => {
      const res = await http()
        .put(`/api/airlines/${airlineId}/baggage-policy`)
        .set('x-dev-user', moderatorOf(airlineId))
        .send({ pricePerBagMinor: 0, maxExtraBagsPerPassenger: -1 })
        .expect(400);
      expect(
        res.body.fieldErrors.map((f: { field: string }) => f.field).sort(),
      ).toEqual(['maxExtraBagsPerPassenger', 'pricePerBagMinor']);
      await http()
        .put(`/api/airlines/${airlineId}/baggage-policy`)
        .set('x-dev-user', moderatorOf(airlineId))
        .send({ pricePerBagMinor: 40.5, maxExtraBagsPerPassenger: 1.5 })
        .expect(400);
    });

    it('only the moderator of this airline may set it', async () => {
      await http()
        .put(`/api/airlines/${airlineId}/baggage-policy`)
        .set('x-dev-user', moderatorOf(new Types.ObjectId().toHexString()))
        .send({ pricePerBagMinor: 1, maxExtraBagsPerPassenger: 9 })
        .expect(403);
      await http()
        .put(`/api/airlines/${airlineId}/baggage-policy`)
        .set('x-dev-user', 'ADMIN')
        .send({ pricePerBagMinor: 1, maxExtraBagsPerPassenger: 9 })
        .expect(403);
      await http()
        .put(`/api/airlines/${airlineId}/baggage-policy`)
        .send({ pricePerBagMinor: 1, maxExtraBagsPerPassenger: 9 })
        .expect(401);
    });
  });

  describe('FLT-09 cancellation tiers', () => {
    const policyUrl = () => `/api/airlines/${airlineId}/cancellation-policy`;
    const preview = (days: string | number) =>
      http().get(`${policyUrl()}/refund-preview?daysRemaining=${days}`);

    it('the assigned moderator sets tiers; they are stored sorted by threshold', async () => {
      const res = await http()
        .put(policyUrl())
        .set('x-dev-user', moderatorOf(airlineId))
        .send({
          tiers: [
            { daysBefore: 7, refundPercent: 50 },
            { daysBefore: 30, refundPercent: 100 },
            { daysBefore: 1, refundPercent: 25.5 },
          ],
        })
        .expect(200);
      expect(res.body.policy.cancellationTiers).toEqual([
        { daysBefore: 1, refundPercent: 25.5 },
        { daysBefore: 7, refundPercent: 50 },
        { daysBefore: 30, refundPercent: 100 },
      ]);
      const after = await http().get(`/api/airlines/${airlineId}`).expect(200);
      expect(after.body.policy.cancellationTiers).toHaveLength(3);
    });

    it('uses the tier with the highest threshold not exceeding the days remaining', async () => {
      const cases: [number, number][] = [
        [40, 100],
        [30, 100],
        [10, 50],
        [7, 50],
        [6, 25.5],
        [1, 25.5],
      ];
      for (const [days, percent] of cases) {
        const res = await preview(days).expect(200);
        expect(res.body.daysRemaining).toBe(days);
        expect(res.body.refundPercent).toBe(percent);
        expect(res.body.tierApplied.refundPercent).toBe(percent);
      }
    });

    it('refunds 0% when no tier applies', async () => {
      const res = await preview(0).expect(200);
      expect(res.body).toEqual({
        daysRemaining: 0,
        tierApplied: null,
        refundPercent: 0,
      });
    });

    it('rejects a repeated threshold (400 on the repeat) and keeps the old tiers', async () => {
      const res = await http()
        .put(policyUrl())
        .set('x-dev-user', moderatorOf(airlineId))
        .send({
          tiers: [
            { daysBefore: 7, refundPercent: 50 },
            { daysBefore: 7, refundPercent: 40 },
          ],
        })
        .expect(400);
      expect(res.body.fieldErrors).toEqual([
        {
          field: 'tiers[1].daysBefore',
          message: 'daysBefore 7 is duplicated',
        },
      ]);
      const after = await http().get(`/api/airlines/${airlineId}`).expect(200);
      expect(after.body.policy.cancellationTiers).toHaveLength(3);
    });

    it('rejects negative or fractional days, refunds outside 0-100 and unknown fields', async () => {
      const res = await http()
        .put(policyUrl())
        .set('x-dev-user', moderatorOf(airlineId))
        .send({
          tiers: [
            { daysBefore: -1, refundPercent: 50 },
            { daysBefore: 2.5, refundPercent: 120 },
            { daysBefore: 3, refundPercent: -5 },
            { daysBefore: 4, refundPercent: 10.123 },
          ],
        })
        .expect(400);
      const fields = new Set(
        res.body.fieldErrors.map((f: { field: string }) => f.field),
      );
      expect([...fields].sort()).toEqual([
        'tiers[0].daysBefore',
        'tiers[1].daysBefore',
        'tiers[1].refundPercent',
        'tiers[2].refundPercent',
        'tiers[3].refundPercent',
      ]);
      await http()
        .put(policyUrl())
        .set('x-dev-user', moderatorOf(airlineId))
        .send({ tiers: [{ daysBefore: 1, refundPercent: 1, fee: 5 }] })
        .expect(400);
      await http()
        .put(policyUrl())
        .set('x-dev-user', moderatorOf(airlineId))
        .send({})
        .expect(400);
    });

    it('rejects day counts too large to count exactly (1e20) with field errors', async () => {
      const res = await http()
        .put(policyUrl())
        .set('x-dev-user', moderatorOf(airlineId))
        .send({ tiers: [{ daysBefore: 1e20, refundPercent: 50 }] })
        .expect(400);
      expect(
        res.body.fieldErrors.map((f: { field: string }) => f.field),
      ).toEqual(['tiers[0].daysBefore']);
      await preview('99999999999999999999').expect(400);
    });

    it('an empty list means no refunds', async () => {
      const res = await http()
        .put(policyUrl())
        .set('x-dev-user', moderatorOf(airlineId))
        .send({ tiers: [] })
        .expect(200);
      expect(res.body.policy.cancellationTiers).toEqual([]);
      expect((await preview(365).expect(200)).body.refundPercent).toBe(0);
    });

    it('only the moderator of this airline may set tiers', async () => {
      const body = { tiers: [{ daysBefore: 0, refundPercent: 100 }] };
      await http()
        .put(policyUrl())
        .set('x-dev-user', moderatorOf(new Types.ObjectId().toHexString()))
        .send(body)
        .expect(403);
      await http()
        .put(policyUrl())
        .set('x-dev-user', admin)
        .send(body)
        .expect(403);
      await http().put(policyUrl()).send(body).expect(401);
    });

    it('the preview validates daysRemaining and returns 404 for an unknown airline', async () => {
      await preview(-1).expect(400);
      await preview('abc').expect(400);
      await preview(1.5).expect(400);
      await http().get(`${policyUrl()}/refund-preview`).expect(400);
      await http()
        .get(
          `/api/airlines/${new Types.ObjectId().toHexString()}/cancellation-policy/refund-preview?daysRemaining=3`,
        )
        .expect(404);
    });
  });
});

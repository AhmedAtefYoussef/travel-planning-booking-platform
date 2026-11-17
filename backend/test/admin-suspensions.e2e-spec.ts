import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import {
  BookingStatus,
  FLIGHT_PAYABLE_BOOKING,
  HOTEL_PAYABLE_BOOKING,
  type PayableBooking,
} from '../src/common/contracts';
import { FlightBooking, HotelReservation } from '../src/modules/bookings';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { AccountStatus, Session, User } from '../src/modules/users';
import { loginAs, TEST_PASSWORD, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/** Own route and dates (FRA -> RUH, March 2029) so no other suite's flights appear in the searches. */
const ROUTE = { from: 'FRA', to: 'RUH' };
const FLIGHT_DATE = '2029-03-15';
const STAY = { checkIn: '2029-03-10', checkOut: '2029-03-12' };

interface AuditRow {
  action: string;
  actor: { id: string; role: string };
  targetType: string;
  targetId: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/** Shared fixtures and helpers for the ACC-15 and ACC-16 suites (one app, one admin). */
function suiteHarness() {
  const ctx = {} as {
    app: INestApplication<App>;
    users: Model<User>;
    sessions: Model<Session>;
    flightBookings: Model<FlightBooking>;
    reservations: Model<HotelReservation>;
    admin: LoggedIn;
  };
  const http = () => request(ctx.app.getHttpServer());

  const patchAccount = (
    id: string,
    action: 'suspend' | 'reactivate',
    body: object = {},
    cookie = ctx.admin.cookie,
  ) =>
    http()
      .patch(`/api/admin/accounts/${id}/${action}`)
      .set('Cookie', cookie)
      .send(body);

  const patchProvider = (
    type: string,
    id: string,
    action: 'deactivate' | 'reactivate',
    body: object = {},
    cookie = ctx.admin.cookie,
  ) =>
    http()
      .patch(`/api/admin/providers/${type}/${id}/${action}`)
      .set('Cookie', cookie)
      .send(body);

  const login = (email: string, password = TEST_PASSWORD) =>
    http().post('/api/auth/login').send({ email, password });

  const statusOf = async (userId: string) =>
    (await ctx.users.findById(userId).lean())?.status;

  const openSessions = (userId: string) =>
    ctx.sessions.countDocuments({
      userId: new Types.ObjectId(userId),
      revokedAt: { $exists: false },
    });

  /** The audit rows of `action` on `targetId`, read through GET /api/admin/audit-logs (GEN-07). */
  const auditRows = async (action: string, targetId: string) => {
    const res = await http()
      .get(`/api/admin/audit-logs?action=${action}`)
      .set('Cookie', ctx.admin.cookie)
      .expect(200);
    return (res.body.items as AuditRow[]).filter(
      (r) => r.targetId === targetId,
    );
  };

  /** The caller's in-app notifications (GEN-01), newest first. */
  const notificationsOf = async (who: LoggedIn) => {
    const res = await http()
      .get('/api/notifications')
      .set('Cookie', who.cookie)
      .expect(200);
    return res.body.items as { type: string; title: string; body: string }[];
  };

  let doc = 7_000_000;
  const adult = () => ({
    type: 'ADULT',
    firstName: 'Mona',
    lastName: 'Adel',
    dateOfBirth: '1990-05-01',
    documentNumber: `S${doc++}`,
  });

  const holdFlight = (
    who: LoggedIn,
    leg: { flightId: string; cabinId: string },
  ) =>
    http()
      .post('/api/flight-bookings/hold')
      .set('Cookie', who.cookie)
      .send({ outbound: leg, passengers: [adult()] });

  const holdHotel = (who: LoggedIn, hotelId: string, roomId: string) =>
    http()
      .post('/api/hotel-bookings')
      .set('Cookie', who.cookie)
      .send({ hotelId, ...STAY, rooms: [{ roomId, adults: 1 }] });

  const searchIds = async () => {
    const res = await http()
      .get('/api/flights/search')
      .query({ ...ROUTE, departureDate: FLIGHT_DATE, passengers: 1 })
      .expect(200);
    return (res.body.items as { flightId: string }[]).map((i) => i.flightId);
  };

  /** An airline (admin creates it) with a real logged-in moderator and one flight FRA -> RUH. */
  async function airlineWithFlight(code: string) {
    const airline = await http()
      .post('/api/airlines')
      .set('Cookie', ctx.admin.cookie)
      .send({ name: `Suspension Air ${code}`, code })
      .expect(201);
    const airlineId = airline.body.id as string;
    const moderator = await loginAs(ctx.app, Role.AirlineModerator, {
      providerId: airlineId,
    });
    const flight = await http()
      .post('/api/flights')
      .set('Cookie', moderator.cookie)
      .send({
        flightNumber: `${code}100`,
        ...ROUTE,
        departureLocal: `${FLIGHT_DATE}T10:00`,
        arrivalLocal: `${FLIGHT_DATE}T15:00`,
      })
      .expect(201);
    const cabin = await http()
      .post(`/api/flights/${flight.body.id}/cabins`)
      .set('Cookie', moderator.cookie)
      .send({
        class: 'ECONOMY',
        totalSeats: 20,
        priceMinor: 90_000,
        freeBags: 1,
        maxKgPerBag: 23,
      })
      .expect(201);
    const cabinId = (cabin.body.cabins as { id: string }[])[0].id;
    return {
      airlineId,
      moderator,
      leg: { flightId: flight.body.id as string, cabinId },
    };
  }

  /** A hotel (admin creates it) with a real logged-in moderator and one bookable room in March 2029. */
  async function hotelWithRoom(name: string) {
    const hotel = await http()
      .post('/api/hotels')
      .set('Cookie', ctx.admin.cookie)
      .send({ name, address: '1 Nile street', cityId: 'cairo' })
      .expect(201);
    const hotelId = hotel.body.id as string;
    const moderator = await loginAs(ctx.app, Role.HotelModerator, {
      providerId: hotelId,
    });
    const roomRes = await http()
      .post(`/api/hotels/${hotelId}/rooms`)
      .set('Cookie', moderator.cookie)
      .send({
        number: 'S1',
        type: 'Double',
        beds: 2,
        maxOccupancy: 2,
        priceMinor: 6_000,
      })
      .expect(201);
    const roomId = roomRes.body.id as string;
    await http()
      .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
      .set('Cookie', moderator.cookie)
      .send({ ranges: [{ from: '2029-03-01', to: '2029-03-31' }] })
      .expect(201);
    return { hotelId, roomId, moderator };
  }

  /** A held then paid booking (PAY-01 confirms through the PayableBooking contract). */
  async function confirmedFlightBooking(
    who: LoggedIn,
    leg: { flightId: string; cabinId: string },
  ) {
    const held = await holdFlight(who, leg).expect(201);
    await ctx.app
      .get<PayableBooking>(FLIGHT_PAYABLE_BOOKING)
      .markConfirmed(held.body.id as string, {
        paymentId: new Types.ObjectId().toHexString(),
      });
    return held.body.id as string;
  }

  async function confirmedHotelReservation(
    who: LoggedIn,
    hotelId: string,
    roomId: string,
  ) {
    const held = await holdHotel(who, hotelId, roomId).expect(201);
    await ctx.app
      .get<PayableBooking>(HOTEL_PAYABLE_BOOKING)
      .markConfirmed(held.body.id as string, {
        paymentId: new Types.ObjectId().toHexString(),
      });
    return held.body.id as string;
  }

  beforeAll(async () => {
    ctx.app = await createTestApp();
    ctx.users = ctx.app.get(getModelToken(User.name));
    ctx.sessions = ctx.app.get(getModelToken(Session.name));
    ctx.flightBookings = ctx.app.get(getModelToken(FlightBooking.name));
    ctx.reservations = ctx.app.get(getModelToken(HotelReservation.name));
    await ctx.app
      .get(ReferenceSeedService)
      .seed(loadReferenceDataset(DATA_DIR));
    ctx.admin = await loginAs(ctx.app, Role.Admin);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  return {
    ctx,
    http,
    patchAccount,
    patchProvider,
    login,
    statusOf,
    openSessions,
    auditRows,
    notificationsOf,
    holdFlight,
    holdHotel,
    searchIds,
    airlineWithFlight,
    hotelWithRoom,
    confirmedFlightBooking,
    confirmedHotelReservation,
  };
}

/** ACC-16: an admin suspends and reactivates registered users; GEN-07 audits both. */
describe('Admin suspends and reactivates registered users (e2e): ACC-16, GEN-07', () => {
  const h = suiteHarness();
  const { ctx } = h;

  it('suspends a user: their cookie session dies, login is refused, Confirmed bookings stay Confirmed, and it is audited', async () => {
    const { leg } = await h.airlineWithFlight('KS');
    const user = await loginAs(ctx.app, Role.User);
    const bookingId = await h.confirmedFlightBooking(user, leg);

    const res = await h
      .patchAccount(user.userId, 'suspend', {
        reason: 'Abusive comments on the blog',
      })
      .expect(200);
    expect(res.body).toEqual({
      id: user.userId,
      name: expect.any(String) as string,
      role: Role.User,
      status: AccountStatus.Suspended,
    });
    expect(await h.statusOf(user.userId)).toBe(AccountStatus.Suspended);

    // The open cookie session and its refresh token are revoked at once.
    expect(await h.openSessions(user.userId)).toBe(0);
    await h.http().get('/api/auth/me').set('Cookie', user.cookie).expect(401);
    await h
      .http()
      .post('/api/auth/refresh')
      .set('Cookie', user.refreshCookie)
      .expect(401);

    // The right password no longer logs in (the auth module answers 403 ACCOUNT_SUSPENDED).
    const login = await h.login(user.email).expect(403);
    expect(login.body.code).toBe('ACCOUNT_SUSPENDED');

    // ACC-16: existing bookings remain valid.
    expect((await ctx.flightBookings.findById(bookingId).lean())?.status).toBe(
      BookingStatus.Confirmed,
    );

    const [row] = await h.auditRows('SUSPEND_ACCOUNT', user.userId);
    expect(row).toMatchObject({
      actor: { id: ctx.admin.userId, role: Role.Admin },
      targetType: 'USER',
      reason: 'Abusive comments on the blog',
      metadata: { targetRole: Role.User, from: 'ACTIVE', to: 'SUSPENDED' },
    });
  });

  it('reactivates a suspended user: login works again, both notifications arrive, the booking is still Confirmed, and it is audited', async () => {
    const { leg } = await h.airlineWithFlight('KT');
    const user = await loginAs(ctx.app, Role.User);
    const bookingId = await h.confirmedFlightBooking(user, leg);
    await h.patchAccount(user.userId, 'suspend').expect(200);

    const res = await h.patchAccount(user.userId, 'reactivate').expect(200);
    expect(res.body).toMatchObject({
      id: user.userId,
      status: AccountStatus.Active,
    });

    const relogin = await h.login(user.email).expect(200);
    const cookie = (relogin.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('access_token='))!
      .split(';')[0];
    const types = (await h.notificationsOf({ ...user, cookie })).map(
      (n) => n.type,
    );
    expect(types).toEqual(
      expect.arrayContaining(['ACCOUNT_SUSPENDED', 'ACCOUNT_REACTIVATED']),
    );
    expect((await ctx.flightBookings.findById(bookingId).lean())?.status).toBe(
      BookingStatus.Confirmed,
    );

    expect(await h.auditRows('REACTIVATE_ACCOUNT', user.userId)).toEqual([
      expect.objectContaining({
        actor: { id: ctx.admin.userId, role: Role.Admin },
        targetType: 'USER',
        metadata: { targetRole: Role.User, from: 'SUSPENDED', to: 'ACTIVE' },
      }),
    ]);
  });

  it('answers 409 when the account is already in that state, including a self-deactivated (ACC-12) account', async () => {
    const user = await loginAs(ctx.app, Role.User);
    const notSuspended = await h
      .patchAccount(user.userId, 'reactivate')
      .expect(409);
    expect(notSuspended.body.code).toBe('CONFLICT');

    await h.patchAccount(user.userId, 'suspend').expect(200);
    const again = await h.patchAccount(user.userId, 'suspend').expect(409);
    expect(again.body.code).toBe('CONFLICT');
    expect(await h.auditRows('SUSPEND_ACCOUNT', user.userId)).toHaveLength(1);

    const gone = await loginAs(ctx.app, Role.User);
    await ctx.users.updateOne(
      { _id: gone.userId },
      { $set: { status: AccountStatus.Deactivated } },
    );
    await h.patchAccount(gone.userId, 'suspend').expect(409);
    await h.patchAccount(gone.userId, 'reactivate').expect(409);
    expect(await h.statusOf(gone.userId)).toBe(AccountStatus.Deactivated);
  });

  it('refuses to suspend yourself or another admin (403) and changes nothing', async () => {
    const self = await h.patchAccount(ctx.admin.userId, 'suspend').expect(403);
    expect(self.body.message).toMatch(/your own account/i);

    const other = await loginAs(ctx.app, Role.Admin);
    const res = await h.patchAccount(other.userId, 'suspend').expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(await h.statusOf(other.userId)).toBe(AccountStatus.Active);
    await h.http().get('/api/auth/me').set('Cookie', other.cookie).expect(200);
    await h.patchAccount(other.userId, 'reactivate').expect(403);
  });

  it('validates the id and the body: 400 for a malformed id or bad reason, 404 for an unknown account', async () => {
    const bad = await h.patchAccount('not-an-id', 'suspend').expect(400);
    expect(bad.body.fieldErrors[0].field).toBe('id');

    await h
      .patchAccount(new Types.ObjectId().toHexString(), 'suspend')
      .expect(404);

    const user = await loginAs(ctx.app, Role.User);
    const long = await h
      .patchAccount(user.userId, 'suspend', { reason: 'x'.repeat(501) })
      .expect(400);
    expect(long.body.fieldErrors[0].field).toBe('reason');
    const extra = await h
      .patchAccount(user.userId, 'suspend', { status: 'ACTIVE' })
      .expect(400);
    expect(extra.body.code).toBe('VALIDATION_FAILED');
    expect(await h.statusOf(user.userId)).toBe(AccountStatus.Active);
  });

  it('is admin only: 401 without a session, 403 for a user or a moderator', async () => {
    const target = await loginAs(ctx.app, Role.User);
    const user = await loginAs(ctx.app, Role.User);
    const moderator = await loginAs(ctx.app, Role.HotelModerator, {
      providerId: new Types.ObjectId().toHexString(),
    });
    await h
      .http()
      .patch(`/api/admin/accounts/${target.userId}/suspend`)
      .expect(401);
    await h.patchAccount(target.userId, 'suspend', {}, user.cookie).expect(403);
    await h
      .patchAccount(target.userId, 'suspend', {}, moderator.cookie)
      .expect(403);
    expect(await h.statusOf(target.userId)).toBe(AccountStatus.Active);
  });
});

/** ACC-15: an admin suspends moderators and deactivates airlines and hotels; GEN-07 audits every change. */
describe('Admin suspends moderators and deactivates providers (e2e): ACC-15, GEN-07', () => {
  const h = suiteHarness();
  const { ctx } = h;

  describe('moderator accounts', () => {
    it('suspends an airline moderator: the session dies and login is refused; reactivation restores it', async () => {
      const { moderator } = await h.airlineWithFlight('KU');

      const res = await h
        .patchAccount(moderator.userId, 'suspend', {
          reason: 'Posted wrong fares',
        })
        .expect(200);
      expect(res.body).toMatchObject({
        role: Role.AirlineModerator,
        status: AccountStatus.Suspended,
      });
      await h
        .http()
        .get('/api/auth/me')
        .set('Cookie', moderator.cookie)
        .expect(401);
      const refused = await h.login(moderator.email).expect(403);
      expect(refused.body.code).toBe('ACCOUNT_SUSPENDED');

      await h.patchAccount(moderator.userId, 'reactivate').expect(200);
      await h.login(moderator.email).expect(200);

      expect(await h.auditRows('SUSPEND_ACCOUNT', moderator.userId)).toEqual([
        expect.objectContaining({
          reason: 'Posted wrong fares',
          metadata: expect.objectContaining({
            targetRole: Role.AirlineModerator,
          }) as object,
        }),
      ]);
      expect(
        await h.auditRows('REACTIVATE_ACCOUNT', moderator.userId),
      ).toHaveLength(1);
    });
  });

  describe('airlines', () => {
    it('deactivates an airline: hidden from search, holds refused with 409 PROVIDER_INACTIVE, Confirmed bookings stay valid, moderator notified, audited', async () => {
      const { airlineId, moderator, leg } = await h.airlineWithFlight('KV');
      const traveller = await loginAs(ctx.app, Role.User);
      const bookingId = await h.confirmedFlightBooking(traveller, leg);
      expect(await h.searchIds()).toContain(leg.flightId);

      const res = await h
        .patchProvider('airline', airlineId, 'deactivate', {
          reason: 'Licence expired',
        })
        .expect(200);
      expect(res.body).toEqual({
        id: airlineId,
        type: 'AIRLINE',
        name: 'Suspension Air KV',
        isActive: false,
      });

      expect(await h.searchIds()).not.toContain(leg.flightId);
      const refused = await h
        .holdFlight(await loginAs(ctx.app, Role.User), leg)
        .expect(409);
      expect(refused.body.code).toBe('PROVIDER_INACTIVE');
      expect(
        (await ctx.flightBookings.findById(bookingId).lean())?.status,
      ).toBe(BookingStatus.Confirmed);

      const [notice] = await h.notificationsOf(moderator);
      expect(notice).toMatchObject({ type: 'PROVIDER_DEACTIVATED' });
      expect(notice.title).toBe('Your airline has been deactivated');
      expect(notice.body).toContain('Suspension Air KV');

      expect(await h.auditRows('DEACTIVATE_PROVIDER', airlineId)).toEqual([
        expect.objectContaining({
          actor: { id: ctx.admin.userId, role: Role.Admin },
          targetType: 'AIRLINE',
          reason: 'Licence expired',
          metadata: {
            providerName: 'Suspension Air KV',
            moderatorsNotified: 1,
          },
        }),
      ]);
    });

    it('reactivates an airline: back in search, bookable again, moderator notified, audited', async () => {
      const { airlineId, moderator, leg } = await h.airlineWithFlight('KW');
      await h.patchProvider('airline', airlineId, 'deactivate').expect(200);

      const res = await h
        .patchProvider('airline', airlineId, 'reactivate')
        .expect(200);
      expect(res.body).toMatchObject({ type: 'AIRLINE', isActive: true });

      expect(await h.searchIds()).toContain(leg.flightId);
      await h.holdFlight(await loginAs(ctx.app, Role.User), leg).expect(201);
      expect((await h.notificationsOf(moderator))[0].type).toBe(
        'PROVIDER_REACTIVATED',
      );
      expect(await h.auditRows('REACTIVATE_PROVIDER', airlineId)).toHaveLength(
        1,
      );
    });
  });

  describe('hotels', () => {
    it('deactivates a hotel: holds refused with 409 PROVIDER_INACTIVE, Confirmed reservations stay valid, moderator notified, audited; reactivation restores booking', async () => {
      const { hotelId, roomId, moderator } = await h.hotelWithRoom(
        'Suspension Test Hotel',
      );
      const guest = await loginAs(ctx.app, Role.User);
      const reservationId = await h.confirmedHotelReservation(
        guest,
        hotelId,
        roomId,
      );

      const res = await h
        .patchProvider('hotel', hotelId, 'deactivate')
        .expect(200);
      expect(res.body).toEqual({
        id: hotelId,
        type: 'HOTEL',
        name: 'Suspension Test Hotel',
        isActive: false,
      });

      const other = await loginAs(ctx.app, Role.User);
      const refused = await h.holdHotel(other, hotelId, roomId).expect(409);
      expect(refused.body.code).toBe('PROVIDER_INACTIVE');
      expect(
        (await ctx.reservations.findById(reservationId).lean())?.status,
      ).toBe(BookingStatus.Confirmed);
      expect((await h.notificationsOf(moderator))[0].type).toBe(
        'PROVIDER_DEACTIVATED',
      );
      expect(await h.auditRows('DEACTIVATE_PROVIDER', hotelId)).toEqual([
        expect.objectContaining({ targetType: 'HOTEL' }),
      ]);

      await h.patchProvider('hotel', hotelId, 'reactivate').expect(200);
      // The confirmed stay still holds its nights, so book the nights after it.
      await h
        .http()
        .post('/api/hotel-bookings')
        .set('Cookie', other.cookie)
        .send({
          hotelId,
          checkIn: '2029-03-20',
          checkOut: '2029-03-21',
          rooms: [{ roomId, adults: 1 }],
        })
        .expect(201);
      expect((await h.notificationsOf(moderator))[0].type).toBe(
        'PROVIDER_REACTIVATED',
      );
      expect(await h.auditRows('REACTIVATE_PROVIDER', hotelId)).toEqual([
        expect.objectContaining({ targetType: 'HOTEL' }),
      ]);
    });
  });

  describe('errors and access', () => {
    it('answers 409 when the provider is already in that state', async () => {
      const { hotelId } = await h.hotelWithRoom('Already Open Hotel');
      const open = await h
        .patchProvider('hotel', hotelId, 'reactivate')
        .expect(409);
      expect(open.body.code).toBe('CONFLICT');
      await h.patchProvider('hotel', hotelId, 'deactivate').expect(200);
      await h.patchProvider('hotel', hotelId, 'deactivate').expect(409);
      expect(await h.auditRows('DEACTIVATE_PROVIDER', hotelId)).toHaveLength(1);
    });

    it('validates the type and id (400) and answers 404 for an unknown provider or the wrong type', async () => {
      const { hotelId } = await h.hotelWithRoom('Typed Hotel');
      const type = await h
        .patchProvider('train', hotelId, 'deactivate')
        .expect(400);
      expect(type.body.fieldErrors[0].field).toBe('type');
      const id = await h
        .patchProvider('hotel', 'nope', 'deactivate')
        .expect(400);
      expect(id.body.fieldErrors[0].field).toBe('id');

      await h
        .patchProvider(
          'airline',
          new Types.ObjectId().toHexString(),
          'deactivate',
        )
        .expect(404);
      // A hotel id is not an airline.
      await h.patchProvider('airline', hotelId, 'deactivate').expect(404);
    });

    it('is admin only: 401 without a session, 403 for a user or the provider moderator', async () => {
      const { hotelId, moderator } = await h.hotelWithRoom('Guarded Hotel');
      const user = await loginAs(ctx.app, Role.User);
      await h
        .http()
        .patch(`/api/admin/providers/hotel/${hotelId}/deactivate`)
        .expect(401);
      await h
        .patchProvider('hotel', hotelId, 'deactivate', {}, user.cookie)
        .expect(403);
      await h
        .patchProvider('hotel', hotelId, 'deactivate', {}, moderator.cookie)
        .expect(403);
      await h.patchProvider('hotel', hotelId, 'reactivate').expect(409); // still active
    });
  });
});

import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import {
  BookingStatus,
  FLIGHT_BOOKINGS_LOOKUP,
  NOTIFICATIONS_SERVICE,
  NotificationType,
} from '../src/common/contracts';
import { FlightBooking } from '../src/modules/bookings';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

interface Notice {
  type: string;
  title: string;
  body: string;
  link: string;
}

/**
 * FLT-05 end to end with the REAL modules (no stand-ins): the flights module's schedule notifier,
 * the bookings module's FLIGHT_BOOKINGS_LOOKUP and the GEN-01 notifications module. A time change
 * reaches only the passengers whose booking is Confirmed, in their own inbox. Airline code FN,
 * CDG -> FRA (both UTC+1 in December).
 */
describe('Flight time change notifies Confirmed passengers (e2e): FLT-05 + GEN-01', () => {
  let app: INestApplication<App>;
  let bookings: Model<FlightBooking>;
  const http = () => request(app.getHttpServer());
  let moderator: LoggedIn;

  /** A booking for `who` on `flightId`, as the bookings module stores it (FLT-19/FLT-22). */
  const booking = (
    who: LoggedIn,
    flightId: string,
    cabinId: string,
    airlineId: string,
    status: BookingStatus,
  ) => ({
    userId: new Types.ObjectId(who.userId),
    tripType: 'ONE_WAY',
    segments: [
      {
        flightId: new Types.ObjectId(flightId),
        cabinId: new Types.ObjectId(cabinId),
        cabinClass: 'ECONOMY',
        airlineId: new Types.ObjectId(airlineId),
        flightNumber: 'FN100',
        from: 'CDG',
        to: 'FRA',
        departureUtc: new Date('2027-12-10T09:00:00Z'),
        arrivalUtc: new Date('2027-12-10T10:15:00Z'),
        seats: 1,
        fareMinor: 12_000,
      },
    ],
    passengers: [
      {
        type: 'ADULT',
        firstName: 'Mona',
        lastName: 'Adel',
        dateOfBirth: '1990-05-01',
        documentNumber: 'A1234567',
        extraBags: 0,
      },
    ],
    totalMinor: 12_000,
    currency: 'EGP',
    status,
    holdExpiresAt: new Date('2027-12-01T00:00:00Z'),
    startsAt: new Date('2027-12-10T09:00:00Z'),
    endsAt: new Date('2027-12-10T10:15:00Z'),
  });

  /** The schedule-change notices in `who`'s inbox, read through the GEN-01 API. */
  const scheduleNotices = async (who: LoggedIn): Promise<Notice[]> => {
    const res = await http()
      .get('/api/notifications')
      .set('Cookie', who.cookie)
      .expect(200);
    return (res.body.items as Notice[]).filter(
      (n) => n.type === (NotificationType.FlightScheduleChanged as string),
    );
  };

  beforeAll(async () => {
    app = await createTestApp(); // the real AppModule: nothing replaced
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    bookings = app.get<Model<FlightBooking>>(getModelToken(FlightBooking.name));
  });

  afterAll(async () => {
    await app.close();
  });

  it('uses the real bookings and notifications modules', () => {
    // Both tokens resolve to real services, not the optional "not wired yet" path.
    expect(app.get(FLIGHT_BOOKINGS_LOOKUP)).toBeDefined();
    expect(app.get(NOTIFICATIONS_SERVICE)).toBeDefined();
  });

  it('a time change reaches only the Confirmed passenger, in their inbox; their price is kept', async () => {
    const admin = await loginAs(app, Role.Admin);
    const airline = await http()
      .post('/api/airlines')
      .set('Cookie', admin.cookie)
      .send({ name: 'Notify Test Air', code: 'FN' })
      .expect(201);
    const airlineId = airline.body.id as string;
    moderator = await loginAs(app, Role.AirlineModerator, {
      providerId: airlineId,
    });

    const created = await http()
      .post('/api/flights')
      .set('Cookie', moderator.cookie)
      .send({
        flightNumber: 'FN100',
        from: 'CDG',
        to: 'FRA',
        departureLocal: '2027-12-10T10:00',
        arrivalLocal: '2027-12-10T11:15',
      })
      .expect(201);
    const flightId = created.body.id as string;
    const withCabin = await http()
      .post(`/api/flights/${flightId}/cabins`)
      .set('Cookie', moderator.cookie)
      .send({
        class: 'ECONOMY',
        totalSeats: 100,
        priceMinor: 12_000,
        freeBags: 1,
        maxKgPerBag: 23,
      })
      .expect(201);
    const cabinId = withCabin.body.cabins[0].id as string;

    // Three passengers: only the Confirmed booking should be notified.
    const confirmed = await loginAs(app, Role.User);
    const pending = await loginAs(app, Role.User);
    const cancelled = await loginAs(app, Role.User);
    const [confirmedBooking] = await bookings.create([
      booking(confirmed, flightId, cabinId, airlineId, BookingStatus.Confirmed),
      booking(
        pending,
        flightId,
        cabinId,
        airlineId,
        BookingStatus.PendingPayment,
      ),
      booking(cancelled, flightId, cabinId, airlineId, BookingStatus.Cancelled),
    ]);

    // The moderator delays the flight by two and a half hours.
    await http()
      .patch(`/api/flights/${flightId}`)
      .set('Cookie', moderator.cookie)
      .send({
        departureLocal: '2027-12-10T12:30',
        arrivalLocal: '2027-12-10T13:45',
      })
      .expect(200);

    expect(await scheduleNotices(confirmed)).toEqual([
      expect.objectContaining({
        type: 'FLIGHT_SCHEDULE_CHANGED',
        title: 'Flight FN100 has a new schedule',
        body: 'CDG → FRA now departs 2027-12-10 12:30 and arrives 2027-12-10 13:45 (local times).',
        link: `/bookings/flights/${confirmedBooking.id}`,
      }),
    ]);
    expect(await scheduleNotices(pending)).toEqual([]);
    expect(await scheduleNotices(cancelled)).toEqual([]);

    // An edit that changes no time notifies nobody again.
    await http()
      .patch(`/api/flights/${flightId}`)
      .set('Cookie', moderator.cookie)
      .send({ departureLocal: '2027-12-10T12:30' })
      .expect(200);
    expect(await scheduleNotices(confirmed)).toHaveLength(1);

    // FLT-05: a price change does not affect the existing booking (it keeps the fare it paid, FLT-22).
    await http()
      .patch(`/api/flights/${flightId}/cabins/${cabinId}`)
      .set('Cookie', moderator.cookie)
      .send({ priceMinor: 20_000 })
      .expect(200);
    const kept = await bookings.findById(confirmedBooking.id).lean();
    expect(kept?.segments[0].fareMinor).toBe(12_000);
    expect(kept?.totalMinor).toBe(12_000);
  });
});

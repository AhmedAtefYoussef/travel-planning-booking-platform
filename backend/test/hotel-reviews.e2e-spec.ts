import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { BookingStatus } from '../src/common/contracts';
import { HotelReservation } from '../src/modules/bookings';
import { Hotel, Review } from '../src/modules/hotels';
import { Payment } from '../src/modules/payments';
import { STRIPE_GATEWAY } from '../src/modules/payments/stripe-gateway';
import { signStripePayload } from '../src/modules/payments/stripe-signature';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { AccountStatus, User } from '../src/modules/users';
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';
import { FakeStripe } from './support/fake-stripe';
import { TEST_ENV } from './support/test-env';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/**
 * HTL-23, HTL-24, GEN-11, ACC-11, ACC-12, GEN-10: one rating and review per Completed reservation,
 * edited or deleted by its author, with the hotel average recalculated; the public rating summary and
 * reviews, newest first. Reservations go through hold, policies, payment and webhook; a stay is ended
 * by moving its endsAt into the past. Own hotel and dates (November 2029, used by no other suite).
 */
describe('Hotel reviews (e2e): HTL-23, HTL-24', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const stripe = new FakeStripe();
  let payments: Model<Payment>;
  let reservations: Model<HotelReservation>;
  let reviews: Model<Review>;
  let hotels: Model<Hotel>;
  let users: Model<User>;
  let hotelId: string;
  let roomIds: string[];
  let day = 0;

  let evt = 0;
  const pay = async (who: LoggedIn, id: string) => {
    const shown = await http()
      .get(`/api/bookings/hotel/${id}/policies`)
      .set('Cookie', who.cookie)
      .expect(200);
    await http()
      .post(`/api/bookings/hotel/${id}/accept-policies`)
      .set('Cookie', who.cookie)
      .send({ accepted: true, version: shown.body.version })
      .expect(200);
    const paid = await http()
      .post('/api/payments')
      .set('Cookie', who.cookie)
      .send({ bookingType: 'HOTEL', bookingId: id })
      .expect(201);
    const pi = (await payments.findById(paid.body.id).lean())!
      .stripePaymentIntentId;
    stripe.setStatus(pi, 'succeeded');
    const body = JSON.stringify({
      id: `evt_hotel_reviews_${++evt}`,
      object: 'event',
      created: Math.floor(Date.now() / 1000),
      type: 'payment_intent.succeeded',
      data: {
        object: { id: pi, object: 'payment_intent', status: 'succeeded' },
      },
    });
    await http()
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set(
        'Stripe-Signature',
        signStripePayload(Buffer.from(body), TEST_ENV.STRIPE_WEBHOOK_SECRET),
      )
      .send(body)
      .expect(200);
  };

  /** A paid two-room reservation on its own nights; `ended` moves its check-out into the past. */
  const stay = async (who: LoggedIn, ended = true) => {
    day += 2;
    const checkIn = `2029-11-${String(day).padStart(2, '0')}`;
    const checkOut = `2029-11-${String(day + 1).padStart(2, '0')}`;
    const res = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', who.cookie)
      .send({
        hotelId,
        checkIn,
        checkOut,
        rooms: [
          { roomId: roomIds[0], adults: 1 },
          { roomId: roomIds[1], adults: 1 },
        ],
      })
      .expect(201);
    const id = res.body.id as string;
    await pay(who, id);
    if (ended) {
      await reservations.updateOne(
        { _id: id },
        { $set: { endsAt: new Date(Date.now() - 60_000) } },
      );
    }
    return id;
  };

  const review = (
    who: LoggedIn | null,
    reservationId: string,
    body: object,
  ) => {
    const req = http().post(`/api/hotel-bookings/${reservationId}/review`);
    if (who) req.set('Cookie', who.cookie);
    return req.send(body);
  };
  const summary = () =>
    http().get(`/api/hotels/${hotelId}/reviews`).expect(200);

  beforeAll(async () => {
    app = await createTestApp(
      [],
      [{ provide: STRIPE_GATEWAY, useValue: stripe }],
    );
    payments = app.get(getModelToken(Payment.name));
    reservations = app.get(getModelToken(HotelReservation.name));
    reviews = app.get(getModelToken(Review.name));
    hotels = app.get(getModelToken(Hotel.name));
    users = app.get(getModelToken(User.name));
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    hotelId = (
      await http()
        .post('/api/hotels')
        .set('x-dev-user', 'ADMIN')
        .send({
          name: 'Review Hotel',
          address: '5 Nile street',
          cityId: 'cairo',
        })
        .expect(201)
    ).body.id as string;
    const mod = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
    roomIds = [];
    for (const number of ['RV1', 'RV2']) {
      const room = await http()
        .post(`/api/hotels/${hotelId}/rooms`)
        .set('x-dev-user', mod)
        .send({
          number,
          type: 'Double',
          beds: 2,
          maxOccupancy: 2,
          priceMinor: 10_000,
        })
        .expect(201);
      await http()
        .post(`/api/hotels/${hotelId}/rooms/${room.body.id}/availability`)
        .set('x-dev-user', mod)
        .send({ ranges: [{ from: '2029-11-01', to: '2029-12-01' }] })
        .expect(201);
      roomIds.push(room.body.id as string);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('HTL-23 completes an ended stay, takes one review for both rooms and recalculates the average', async () => {
    const mona = await loginAs(app, Role.User);
    const omar = await loginAs(app, Role.User);
    const first = await stay(mona);
    const second = await stay(omar);

    // The minute job has not run: the review completes the stay on the spot (GEN-11).
    const created = await review(mona, first, {
      rating: 5,
      text: '  Great view of the Nile.  ',
    }).expect(201);
    expect(created.body).toMatchObject({
      hotelId,
      reservationId: first,
      rating: 5,
      text: 'Great view of the Nile.',
      author: { id: mona.userId, name: 'E2E USER' },
    });
    expect((await reservations.findById(first).lean())!.status).toBe(
      BookingStatus.Completed,
    );

    // One review per reservation, however many rooms (409, unique index).
    const again = await review(mona, first, { rating: 1 }).expect(409);
    expect(again.body.code).toBe('REVIEW_ALREADY_EXISTS');
    expect(
      await reviews.countDocuments({
        reservationId: new Types.ObjectId(first),
      }),
    ).toBe(1);

    await review(omar, second, { rating: 2 }).expect(201);
    expect((await summary()).body).toMatchObject({
      ratingAvg: 3.5,
      ratingCount: 2,
    });
    expect((await hotels.findById(hotelId).lean())!).toMatchObject({
      ratingAvg: 3.5,
      ratingCount: 2,
    });

    // The author edits: the average follows. Anyone else: 403.
    await http()
      .patch(`/api/reviews/${created.body.id}`)
      .set('Cookie', omar.cookie)
      .send({ rating: 1 })
      .expect(403);
    const edited = await http()
      .patch(`/api/reviews/${created.body.id}`)
      .set('Cookie', mona.cookie)
      .send({ rating: 4, text: '' })
      .expect(200);
    expect(edited.body).toMatchObject({ rating: 4, text: '' });
    expect((await summary()).body).toMatchObject({
      ratingAvg: 3,
      ratingCount: 2,
    });

    // The author deletes: the average follows, and the stay can be reviewed again.
    await http()
      .delete(`/api/reviews/${created.body.id}`)
      .set('Cookie', omar.cookie)
      .expect(403);
    await http()
      .delete(`/api/reviews/${created.body.id}`)
      .set('Cookie', mona.cookie)
      .expect(204);
    expect((await summary()).body).toMatchObject({
      ratingAvg: 2,
      ratingCount: 1,
    });
    expect((await hotels.findById(hotelId).lean())!).toMatchObject({
      ratingAvg: 2,
      ratingCount: 1,
    });
    await review(mona, first, { rating: 3 }).expect(201);
    await http()
      .patch(`/api/reviews/${new Types.ObjectId().toHexString()}`)
      .set('Cookie', mona.cookie)
      .send({ rating: 3 })
      .expect(404);
  });

  it('HTL-23 refuses a stay that is not completed, and answers a stranger like an unknown id', async () => {
    const owner = await loginAs(app, Role.User);
    const upcoming = await stay(owner, false);
    const res = await review(owner, upcoming, { rating: 4 }).expect(409);
    expect(res.body.code).toBe('RESERVATION_NOT_COMPLETED');

    const ended = await stay(owner);
    const stranger = await loginAs(app, Role.User);
    const theirs = await review(stranger, ended, { rating: 1 }).expect(404);
    const unknown = await review(stranger, new Types.ObjectId().toHexString(), {
      rating: 1,
    }).expect(404);
    expect(theirs.body.message).toBe(unknown.body.message);

    const cancelled = await stay(owner, false);
    await reservations.updateOne(
      { _id: cancelled },
      { $set: { status: BookingStatus.Cancelled, endsAt: new Date(0) } },
    );
    await review(owner, cancelled, { rating: 4 }).expect(409);
    await review(null, ended, { rating: 4 }).expect(401);
  });

  it('HTL-23 validates the rating (whole 1-5) and the text (max 1000) with fieldErrors (GEN-02)', async () => {
    const owner = await loginAs(app, Role.User);
    const id = await stay(owner);
    for (const body of [
      { rating: 0 },
      { rating: 6 },
      { rating: 4.5 },
      { rating: '5' },
      {},
    ]) {
      const res = await review(owner, id, body).expect(400);
      const fields = (res.body.fieldErrors as { field: string }[]).map(
        (f) => f.field,
      );
      expect([...new Set(fields)]).toEqual(['rating']);
    }
    const long = await review(owner, id, {
      rating: 4,
      text: 'x'.repeat(1001),
    }).expect(400);
    expect(long.body.fieldErrors).toEqual([
      { field: 'text', message: 'text must be at most 1000 characters' },
    ]);
    await review(owner, id, { rating: 4, text: 'x'.repeat(1000) }).expect(201);
    const reviewId = (await reviews
      .findOne({ reservationId: new Types.ObjectId(id) })
      .lean())!._id.toHexString();
    const nulls = await http()
      .patch(`/api/reviews/${reviewId}`)
      .set('Cookie', owner.cookie)
      .send({ rating: null })
      .expect(400);
    expect(nulls.body.code).toBe('VALIDATION_FAILED');
  });

  it('HTL-24 is public: newest first, 10 per page, hidden reviews not counted, deactivated authors as "Deleted user"', async () => {
    const hotel = (
      await http()
        .post('/api/hotels')
        .set('x-dev-user', 'ADMIN')
        .send({
          name: 'Listing Hotel',
          address: '6 Nile street',
          cityId: 'cairo',
        })
        .expect(201)
    ).body.id as string;
    const author = await loginAs(app, Role.User);
    const docs = Array.from({ length: 12 }, (_, i) => ({
      hotelId: new Types.ObjectId(hotel),
      reservationId: new Types.ObjectId(),
      userId: new Types.ObjectId(author.userId),
      rating: (i % 5) + 1,
      text: `Review ${i}`,
      createdAt: new Date(Date.UTC(2029, 10, 1, i)),
      isHidden: i === 11,
    }));
    await reviews.insertMany(docs);
    await users.updateOne(
      { _id: author.userId },
      { $set: { status: AccountStatus.Deactivated } },
    );

    const first = await http().get(`/api/hotels/${hotel}/reviews`).expect(200);
    // 11 visible reviews: ratings 1,2,3,4,5,1,2,3,4,5,1 -> 31 / 11 = 2.8.
    expect(first.body).toMatchObject({
      ratingAvg: 2.8,
      ratingCount: 11,
      page: 1,
      limit: 10,
      total: 11,
      totalPages: 2,
    });
    expect((first.body.items as { text: string }[]).map((r) => r.text)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Review ${10 - i}`),
    );
    expect(first.body.items[0].author).toEqual({
      id: author.userId,
      name: 'Deleted user',
    });
    const second = await http()
      .get(`/api/hotels/${hotel}/reviews?page=2`)
      .expect(200);
    expect(
      (second.body.items as { text: string }[]).map((r) => r.text),
    ).toEqual(['Review 0']);

    // An unknown or deactivated hotel is 404 (ACC-15); no page size parameter (GEN-05).
    await http()
      .get(`/api/hotels/${new Types.ObjectId().toHexString()}/reviews`)
      .expect(404);
    await hotels.updateOne({ _id: hotel }, { $set: { isActive: false } });
    await http().get(`/api/hotels/${hotel}/reviews`).expect(404);
    await http().get(`/api/hotels/${hotelId}/reviews?limit=50`).expect(400);
  });
});

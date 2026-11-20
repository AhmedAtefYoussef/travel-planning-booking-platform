import { join } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { Types } from 'mongoose';
import request from 'supertest';
import { Role } from '../src/common/auth/auth.types';
import type {
  HotelSearchQuery,
  HotelsSearch,
} from '../src/common/contracts/services.contract';
import { HOTELS_SEARCH } from '../src/common/contracts/tokens';
import { toPage } from '../src/common/pagination/pagination';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { loginAs } from './support/auth';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/**
 * ITN-25: hotels for one city group of the caller's itinerary, through the shared HTL-11 search
 * (HOTELS_SEARCH). One test checks the exact query through a fake search, one runs the real search.
 */
describe('Itinerary hotel search (e2e): ITN-25', () => {
  const calls: HotelSearchQuery[] = [];
  const fakeHotels: HotelsSearch = {
    search: (query) => {
      calls.push(query);
      return Promise.resolve(
        toPage(
          [
            {
              hotelId: 'h1',
              name: 'Nile View',
              cityId: query.cityId ?? '',
              averageRating: 4.5,
              fromPriceMinor: 30000,
            },
          ],
          1,
          query.page,
        ),
      );
    },
  };
  @Global()
  @Module({
    providers: [{ provide: HOTELS_SEARCH, useValue: fakeHotels }],
    exports: [HOTELS_SEARCH],
  })
  class FakeHotelSearchModule {}

  async function setup(withSearch: boolean, startDate = '2027-07-30') {
    // The override replaces HTL-11's real HOTELS_SEARCH (a second global provider alone would be
    // ignored); without it the app uses the real search.
    const app = withSearch
      ? await createTestApp(
          [FakeHotelSearchModule],
          [{ provide: HOTELS_SEARCH, useValue: fakeHotels }],
        )
      : await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    const owner = await loginAs(app, Role.User);
    const http = () => request(app.getHttpServer());
    const id = (
      await http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send({
          title: 'Hotels',
          countries: ['EG', 'AE'],
          startDate,
        })
        .expect(201)
    ).body.id as string;
    for (const cityId of ['cairo', 'cairo', 'dubai', 'dubai', 'dubai']) {
      await http()
        .post(`/api/itineraries/${id}/days`)
        .set('Cookie', owner.cookie)
        .send({ cityId })
        .expect(201);
    }
    return { app, owner, http, id };
  }

  it('searches the group city from its first day to the day after its last day', async () => {
    const { app, owner, http, id } = await setup(true);
    try {
      const res = await http()
        .get(`/api/itineraries/${id}/hotels?group=2&guests=3&rooms=2`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(res.body).toMatchObject({
        group: {
          cityId: 'dubai',
          fromDay: 3,
          toDay: 5,
          startDate: '2027-08-01',
          endDate: '2027-08-03',
        },
        checkIn: '2027-08-01',
        checkOut: '2027-08-04',
        guests: 3,
        rooms: 2,
        hotels: { items: [{ hotelId: 'h1' }], page: 1, total: 1 },
      });
      expect(calls[calls.length - 1]).toEqual({
        cityId: 'dubai',
        checkIn: '2027-08-01',
        checkOut: '2027-08-04',
        guests: 3,
        rooms: 2,
        page: 1,
      });
      const first = await http()
        .get(`/api/itineraries/${id}/hotels?group=1&guests=1`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(first.body).toMatchObject({
        checkIn: '2027-07-30',
        checkOut: '2027-08-01',
        rooms: 1,
      });

      const tooFar = await http()
        .get(`/api/itineraries/${id}/hotels?group=3&guests=1`)
        .set('Cookie', owner.cookie)
        .expect(400);
      expect(tooFar.body.fieldErrors).toEqual([
        expect.objectContaining({ field: 'group' }),
      ]);
      await http()
        .get(`/api/itineraries/${id}/hotels?guests=1`)
        .set('Cookie', owner.cookie)
        .expect(400);
      await http()
        .get(`/api/itineraries/${id}/hotels?group=1&guests=0`)
        .set('Cookie', owner.cookie)
        .expect(400);
      await http()
        .get(`/api/itineraries/${id}/hotels?group=1`)
        .set('Cookie', owner.cookie)
        .expect(400);

      const stranger = await loginAs(app, Role.User);
      await http()
        .get(`/api/itineraries/${id}/hotels?group=1&guests=1`)
        .set('Cookie', stranger.cookie)
        .expect(404);
      await http()
        .get(`/api/itineraries/${id}/hotels?group=1&guests=1`)
        .expect(401);
    } finally {
      await app.close();
    }
  });

  it('uses the real HTL-11 search: the group city hotels free for the stay, cheapest first', async () => {
    // A year no other suite uses, so other suites' hotels are not free on these nights.
    const { app, owner, http, id } = await setup(false, '2033-07-30');
    try {
      /** A hotel with one room per [occupancy, price per night], bookable from 25 Jul to 10 Aug 2033. */
      const hotel = async (
        name: string,
        cityId: string,
        rooms: [number, number][],
      ) => {
        const hotelId = (
          await http()
            .post('/api/hotels')
            .set('x-dev-user', 'ADMIN')
            .send({ name, address: '1 Test street', cityId })
            .expect(201)
        ).body.id as string;
        const moderator = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
        let n = 0;
        for (const [maxOccupancy, priceMinor] of rooms) {
          const roomId = (
            await http()
              .post(`/api/hotels/${hotelId}/rooms`)
              .set('x-dev-user', moderator)
              .send({
                number: `${name[0]}${++n}`,
                type: 'Room',
                beds: 1,
                maxOccupancy,
                priceMinor,
              })
              .expect(201)
          ).body.id as string;
          await http()
            .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
            .set('x-dev-user', moderator)
            .send({ ranges: [{ from: '2033-07-25', to: '2033-08-10' }] })
            .expect(201);
        }
        return hotelId;
      };
      const pyramids = await hotel('Pyramids Inn', 'cairo', [[2, 9_000]]);
      const nile = await hotel('Nile Budget', 'cairo', [[2, 5_000]]);
      const marina = await hotel('Marina Stay', 'dubai', [[4, 20_000]]);

      // Group 1: Cairo, days 1-2 (30-31 Jul), so 2 nights checking out on 1 Aug.
      const cairo = await http()
        .get(`/api/itineraries/${id}/hotels?group=1&guests=2`)
        .set('Cookie', owner.cookie)
        .expect(200);
      // The e2e suites share one database, so only the hotels made here are compared.
      const mine = (res: request.Response) =>
        (res.body.hotels.items as { hotelId: string; fromPriceMinor: number }[])
          .filter((h) => [pyramids, nile, marina].includes(h.hotelId))
          .map((h) => [h.hotelId, h.fromPriceMinor]);
      expect(cairo.body).toMatchObject({
        checkIn: '2033-07-30',
        checkOut: '2033-08-01',
        hotels: { page: 1 },
      });
      expect(mine(cairo)).toEqual([
        [nile, 10_000],
        [pyramids, 18_000],
      ]);

      // Group 2: Dubai, days 3-5 (1-3 Aug), 3 nights.
      const dubai = await http()
        .get(`/api/itineraries/${id}/hotels?group=2&guests=3`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(mine(dubai)).toEqual([[marina, 60_000]]);

      // HTL-11's own rules come back unchanged: more rooms than guests is a 400 on rooms.
      const rooms = await http()
        .get(`/api/itineraries/${id}/hotels?group=1&guests=2&rooms=3`)
        .set('Cookie', owner.cookie)
        .expect(400);
      expect(rooms.body.fieldErrors).toEqual([
        expect.objectContaining({ field: 'rooms' }),
      ]);
    } finally {
      await app.close();
    }
  });
});

/** ITN-26: flights from an origin to the first day's city, reusing FLT-11/FLT-12. */

import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { HOTELS_SEARCH } from '../src/common/contracts';
import type { HotelsSearch } from '../src/common/contracts/services.contract';
import { ValidationFailedException } from '../src/common/errors/app.exception';
import { Hotel, RoomNight, RoomNightKind } from '../src/modules/hotels';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/** HTL-11: search hotels by city or country, dates, guests and rooms. */
describe('Hotel search (e2e): HTL-11', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const JAN = { from: '2027-01-01', to: '2027-02-01' };
  const stay = { checkIn: '2027-01-10', checkOut: '2027-01-13' };
  const ids: Record<string, string> = {};

  const search = (query: Record<string, string | number>) =>
    http().get('/api/hotels/search').query(query);
  const names = (res: request.Response) =>
    (res.body.items as { name: string }[]).map((i) => i.name);

  /** A hotel with rooms [occupancy, priceMinor], each bookable all of January. */
  const hotel = async (
    name: string,
    cityId: string,
    rooms: [number, number][],
  ) => {
    const id = (
      await http()
        .post('/api/hotels')
        .set('x-dev-user', 'ADMIN')
        .send({ name, address: '1 Test street', cityId })
        .expect(201)
    ).body.id as string;
    const mod = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${id}`;
    let n = 0;
    for (const [maxOccupancy, priceMinor] of rooms) {
      const roomId = (
        await http()
          .post(`/api/hotels/${id}/rooms`)
          .set('x-dev-user', mod)
          .send({
            number: `${name[0]}${++n}`,
            type: 'Room',
            beds: 1,
            maxOccupancy,
            priceMinor,
          })
          .expect(201)
      ).body.id as string;
      ids[`${name}#${n}`] = roomId;
      await http()
        .post(`/api/hotels/${id}/rooms/${roomId}/availability`)
        .set('x-dev-user', mod)
        .send({ ranges: [JAN] })
        .expect(201);
    }
    ids[name] = id;
    ids[`${name}:mod`] = mod;
    return id;
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    await hotel('Tokyo Big', 'tokyo', [
      [4, 20_000],
      [2, 9_000],
    ]);
    await hotel('Tokyo Small', 'tokyo', [[2, 6_000]]);
    await hotel('Booked Inn', 'tokyo', [[4, 5_000]]);
    await hotel('Closed Inn', 'tokyo', [[4, 4_000]]);
    await hotel('Rhine Hotel', 'frankfurt', [[3, 15_000]]);
    // Booked Inn's only room is booked on one night of the stay; Closed Inn is deactivated.
    await app.get<Model<RoomNight>>(getModelToken(RoomNight.name)).create({
      roomId: new Types.ObjectId(ids['Booked Inn#1']),
      hotelId: new Types.ObjectId(ids['Booked Inn']),
      date: '2027-01-11',
      kind: RoomNightKind.BOOKED,
      reservationId: new Types.ObjectId(),
    });
    await app
      .get<Model<Hotel>>(getModelToken(Hotel.name))
      .updateOne({ _id: ids['Closed Inn'] }, { isActive: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists active hotels in the city with a free room for every night, cheapest first', async () => {
    const res = await search({ cityId: 'tokyo', ...stay, guests: 2 }).expect(
      200,
    );
    expect(names(res)).toEqual(['Tokyo Small', 'Tokyo Big']);
    expect(res.body).toMatchObject({
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
    });
    expect(res.body.items[0]).toMatchObject({
      hotelId: ids['Tokyo Small'],
      cityId: 'tokyo',
      countryCode: 'JP',
      averageRating: null,
      fromPricePerNightMinor: 6000,
      fromPriceMinor: 18000,
      freeRooms: 1,
    });
  });

  it('only lists hotels whose rooms can hold all the guests', async () => {
    const four = await search({ cityId: 'tokyo', ...stay, guests: 4 }).expect(
      200,
    );
    expect(names(four)).toEqual(['Tokyo Big']);
    // The price is the 4-person room's, not the cheaper 2-person room's.
    expect(four.body.items[0]).toMatchObject({
      fromPricePerNightMinor: 20000,
      fromPriceMinor: 60000,
    });
    const five = await search({ cityId: 'tokyo', ...stay, guests: 5 }).expect(
      200,
    );
    expect(names(five)).toEqual([]);
    const twoRooms = await search({
      cityId: 'tokyo',
      ...stay,
      guests: 5,
      rooms: 2,
    }).expect(200);
    expect(names(twoRooms)).toEqual(['Tokyo Big']);
  });

  it('searches a whole country', async () => {
    const jp = await search({ countryCode: 'jp', ...stay, guests: 1 }).expect(
      200,
    );
    expect(names(jp)).toEqual(['Tokyo Small', 'Tokyo Big']);
    const de = await search({ countryCode: 'DE', ...stay, guests: 1 }).expect(
      200,
    );
    expect(names(de)).toEqual(['Rhine Hotel']);
  });

  it('a stay outside the bookable dates finds nothing; a free stay finds the booked hotel too', async () => {
    const feb = await search({
      cityId: 'tokyo',
      checkIn: '2027-01-30',
      checkOut: '2027-02-02',
      guests: 1,
    }).expect(200);
    expect(names(feb)).toEqual([]);
    const later = await search({
      cityId: 'tokyo',
      checkIn: '2027-01-20',
      checkOut: '2027-01-22',
      guests: 1,
    }).expect(200);
    expect(names(later)).toEqual(['Booked Inn', 'Tokyo Small', 'Tokyo Big']);
  });

  it('leaves out rooms the moderator deactivated or blocked (HTL-06), and finds them again once undone', async () => {
    await hotel('Paused Inn', 'riyadh', [[2, 8_000]]);
    await hotel('Blocked Inn', 'riyadh', [[2, 7_000]]);
    const riyadh = () =>
      search({ cityId: 'riyadh', ...stay, guests: 2 }).expect(200);
    expect(names(await riyadh())).toEqual(['Blocked Inn', 'Paused Inn']);

    const pausedRoom = `/api/hotels/${ids['Paused Inn']}/rooms/${ids['Paused Inn#1']}`;
    await http()
      .patch(pausedRoom)
      .set('x-dev-user', ids['Paused Inn:mod'])
      .send({ isActive: false })
      .expect(200);
    const blocks = `/api/hotels/${ids['Blocked Inn']}/rooms/${ids['Blocked Inn#1']}/blocks`;
    const oneNight = { ranges: [{ from: '2027-01-11', to: '2027-01-12' }] };
    await http()
      .post(blocks)
      .set('x-dev-user', ids['Blocked Inn:mod'])
      .send(oneNight)
      .expect(201);
    expect(names(await riyadh())).toEqual([]);

    await http()
      .patch(pausedRoom)
      .set('x-dev-user', ids['Paused Inn:mod'])
      .send({ isActive: true })
      .expect(200);
    await http()
      .delete(blocks)
      .set('x-dev-user', ids['Blocked Inn:mod'])
      .send(oneNight)
      .expect(200);
    expect(names(await riyadh())).toEqual(['Blocked Inn', 'Paused Inn']);
  });

  it('rejects bad input with field errors', async () => {
    const field = async (
      query: Record<string, string | number>,
    ): Promise<string[]> => {
      const res = await search(query).expect(400);
      return (res.body.fieldErrors as { field: string }[]).map((f) => f.field);
    };
    expect(await field({ ...stay, guests: 1 })).toContain('cityId');
    expect(
      await field({ cityId: 'tokyo', countryCode: 'JP', ...stay, guests: 1 }),
    ).toContain('countryCode');
    expect(
      await field({
        cityId: 'tokyo',
        checkIn: '2020-01-01',
        checkOut: '2020-01-03',
        guests: 1,
      }),
    ).toContain('checkIn');
    expect(
      await field({
        cityId: 'tokyo',
        checkIn: '2027-01-10',
        checkOut: '2027-01-10',
        guests: 1,
      }),
    ).toContain('checkOut');
    expect(await field({ cityId: 'tokyo', ...stay })).toContain('guests');
    expect(await field({ cityId: 'tokyo', ...stay, guests: 0 })).toContain(
      'guests',
    );
    expect(await field({ cityId: 'tokyo', ...stay, guests: 1.5 })).toContain(
      'guests',
    );
    expect(
      await field({ cityId: 'tokyo', ...stay, guests: 2, rooms: 11 }),
    ).toContain('rooms');
    expect(
      await field({ cityId: 'tokyo', ...stay, guests: 1, rooms: 2 }),
    ).toContain('rooms');
  });

  it('pages results 10 at a time and answers an unknown city with an empty page', async () => {
    const res = await search({
      cityId: 'tokyo',
      ...stay,
      guests: 1,
      page: 2,
    }).expect(200);
    expect(res.body).toMatchObject({ items: [], page: 2, total: 2 });
    const none = await search({ cityId: 'nowhere', ...stay, guests: 1 }).expect(
      200,
    );
    expect(none.body).toMatchObject({ items: [], total: 0 });
  });

  it('is also available to other modules as HOTELS_SEARCH (ITN-25)', async () => {
    const service = app.get<HotelsSearch>(HOTELS_SEARCH);
    const page = await service.search({
      cityId: 'frankfurt',
      ...stay,
      guests: 2,
      rooms: 1,
      page: 1,
    });
    expect(page.items).toEqual([
      expect.objectContaining({
        hotelId: ids['Rhine Hotel'],
        name: 'Rhine Hotel',
        fromPriceMinor: 45000,
      }),
    ]);
  });

  it('applies the HTL-11 rules to HOTELS_SEARCH callers too, with the same field errors', async () => {
    const service = app.get<HotelsSearch>(HOTELS_SEARCH);
    const fieldOf = async (change: object): Promise<string | undefined> => {
      const error = (await service
        .search({
          cityId: 'frankfurt',
          ...stay,
          guests: 2,
          rooms: 1,
          page: 1,
          ...change,
        })
        .catch((e: unknown) => e)) as ValidationFailedException;
      expect(error).toBeInstanceOf(ValidationFailedException);
      return error.fieldErrors?.[0]?.field;
    };
    expect(await fieldOf({ checkOut: '2027-01-10' })).toBe('checkOut');
    expect(await fieldOf({ checkOut: '2027-03-01' })).toBe('checkOut');
    expect(await fieldOf({ checkIn: '2027-02-30' })).toBe('checkIn');
    expect(
      await fieldOf({ checkIn: '2020-01-01', checkOut: '2020-01-03' }),
    ).toBe('checkIn');
    expect(await fieldOf({ guests: 0 })).toBe('guests');
    expect(await fieldOf({ guests: 51 })).toBe('guests');
    expect(await fieldOf({ rooms: 0 })).toBe('rooms');
    expect(await fieldOf({ guests: 1, rooms: 2 })).toBe('rooms');
  });
});

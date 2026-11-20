import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { HOTELS_SEARCH } from '../src/common/contracts';
import type { HotelsSearch } from '../src/common/contracts/services.contract';
import { ValidationFailedException } from '../src/common/errors/app.exception';
import { Review } from '../src/modules/hotels';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/**
 * HTL-12: price per night and minimum rating filters, sort by price or rating. New York only, so no
 * other e2e file's hotels appear (all e2e files share one database).
 */
describe('Hotel search filters and sort (e2e): HTL-12', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const stay = {
    cityId: 'new_york',
    checkIn: '2027-01-10',
    checkOut: '2027-01-12',
    guests: 1,
  };
  const search = (query: Record<string, string | number> = {}) =>
    http()
      .get('/api/hotels/search')
      .query({ ...stay, ...query });
  const names = (res: request.Response) =>
    (res.body.items as { name: string }[]).map((i) => i.name);

  /** A New York hotel with rooms at these prices, bookable all January, and these review ratings. */
  const hotel = async (name: string, prices: number[], ratings: number[]) => {
    const id = (
      await http()
        .post('/api/hotels')
        .set('x-dev-user', 'ADMIN')
        .send({ name, address: '1 Test street', cityId: 'new_york' })
        .expect(201)
    ).body.id as string;
    const mod = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${id}`;
    let n = 0;
    for (const priceMinor of prices) {
      const roomId = (
        await http()
          .post(`/api/hotels/${id}/rooms`)
          .set('x-dev-user', mod)
          .send({
            number: `R${++n}`,
            type: 'Room',
            beds: 1,
            maxOccupancy: 2,
            priceMinor,
          })
          .expect(201)
      ).body.id as string;
      await http()
        .post(`/api/hotels/${id}/rooms/${roomId}/availability`)
        .set('x-dev-user', mod)
        .send({ ranges: [{ from: '2027-01-01', to: '2027-02-01' }] })
        .expect(201);
    }
    const reviews = app.get<Model<Review>>(getModelToken(Review.name));
    for (const rating of ratings) {
      await reviews.create({
        hotelId: new Types.ObjectId(id),
        reservationId: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        rating,
      });
    }
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    // Cheapest free room per night: Budget 5000, Mid 10000 (its 30000 room is ignored), Lux 20000.
    await hotel('Budget', [5_000], [3]);
    await hotel('Mid', [30_000, 10_000], [4, 5]);
    await hotel('Lux', [20_000], [5]);
    await hotel('Unrated', [8_000], []);
  });

  afterAll(async () => {
    await app.close();
  });

  it('defaults to cheapest first by the cheapest free room per night', async () => {
    const res = await search().expect(200);
    expect(names(res)).toEqual(['Budget', 'Unrated', 'Mid', 'Lux']);
    expect(res.body.items[2]).toMatchObject({
      name: 'Mid',
      fromPricePerNightMinor: 10000,
      averageRating: 4.5,
    });
  });

  it('price filter: inclusive bounds on the cheapest qualifying room', async () => {
    const res = await search({
      minPriceMinor: 8000,
      maxPriceMinor: 20000,
    }).expect(200);
    expect(names(res)).toEqual(['Unrated', 'Mid', 'Lux']);
    const exact = await search({
      minPriceMinor: 10000,
      maxPriceMinor: 10000,
    }).expect(200);
    expect(names(exact)).toEqual(['Mid']);
    // Mid has a 30000 room, but its cheapest is 10000, so it is out of 25000-40000.
    const high = await search({ minPriceMinor: 25000 }).expect(200);
    expect(names(high)).toEqual([]);
  });

  it('price filter uses the rooms that hold the guests: two rooms are priced together', async () => {
    const two = await search({ guests: 4, rooms: 2 }).expect(200);
    expect(two.body.items).toEqual([
      expect.objectContaining({ name: 'Mid', fromPricePerNightMinor: 40000 }),
    ]);
    const capped = await search({
      guests: 4,
      rooms: 2,
      maxPriceMinor: 30000,
    }).expect(200);
    expect(names(capped)).toEqual([]);
  });

  it('rating filter: minimum visible average, unrated hotels left out', async () => {
    const four = await search({ minRating: 4 }).expect(200);
    expect(names(four)).toEqual(['Mid', 'Lux']);
    const one = await search({ minRating: 1 }).expect(200);
    expect(names(one)).not.toContain('Unrated');
    const half = await search({ minRating: 4.5 }).expect(200);
    expect(names(half)).toEqual(['Mid', 'Lux']);
  });

  it('sort=rating: highest first, unrated last, ties to the cheaper hotel', async () => {
    const res = await search({ sort: 'rating' }).expect(200);
    expect(names(res)).toEqual(['Lux', 'Mid', 'Budget', 'Unrated']);
    const both = await search({ sort: 'rating', maxPriceMinor: 10000 }).expect(
      200,
    );
    expect(names(both)).toEqual(['Mid', 'Budget', 'Unrated']);
  });

  it('rejects bad filters with one field error each', async () => {
    const field = async (query: Record<string, string | number>) => {
      const res = await search(query).expect(400);
      return (res.body.fieldErrors as { field: string }[]).map((f) => f.field);
    };
    expect(await field({ minPriceMinor: 9000, maxPriceMinor: 8000 })).toEqual([
      'maxPriceMinor',
    ]);
    expect(await field({ minPriceMinor: -1 })).toEqual(['minPriceMinor']);
    expect(await field({ maxPriceMinor: 99.5 })).toEqual(['maxPriceMinor']);
    expect(await field({ minRating: 0 })).toEqual(['minRating']);
    expect(await field({ minRating: 6 })).toEqual(['minRating']);
    expect(await field({ minRating: 4.25 })).toEqual(['minRating']);
    expect(await field({ sort: 'name' })).toEqual(['sort']);
    // Not a number at all: still one error each, with the whole-number message (GEN-02).
    expect(await field({ minPriceMinor: 'abc' })).toEqual(['minPriceMinor']);
    expect(await field({ maxPriceMinor: 'abc' })).toEqual(['maxPriceMinor']);
    expect(await field({ minRating: 'abc' })).toEqual(['minRating']);
    const abc = await search({ minPriceMinor: 'abc' }).expect(400);
    expect(abc.body.fieldErrors).toEqual([
      expect.objectContaining({
        field: 'minPriceMinor',
        message:
          'minPriceMinor must be a whole number of minor units, 0 or more',
      }),
    ]);
  });

  it('applies the same filter rules to HOTELS_SEARCH callers, and filters for them too', async () => {
    const service = app.get<HotelsSearch>(HOTELS_SEARCH);
    const base = { ...stay, rooms: 1, page: 1 };
    const fieldOf = async (change: object) => {
      const error = (await service
        .search({ ...base, ...change })
        .catch((e: unknown) => e)) as ValidationFailedException;
      expect(error).toBeInstanceOf(ValidationFailedException);
      return error.fieldErrors?.[0]?.field;
    };
    expect(await fieldOf({ minPriceMinor: -1 })).toBe('minPriceMinor');
    expect(await fieldOf({ maxPriceMinor: 99.5 })).toBe('maxPriceMinor');
    expect(await fieldOf({ minPriceMinor: 9000, maxPriceMinor: 8000 })).toBe(
      'maxPriceMinor',
    );
    expect(await fieldOf({ minRating: 0 })).toBe('minRating');
    expect(await fieldOf({ minRating: Number.NaN })).toBe('minRating');
    expect(await fieldOf({ minRating: 4.25 })).toBe('minRating');
    expect(await fieldOf({ sort: 'name' })).toBe('sort');

    const page = await service.search({
      ...base,
      minRating: 4.5,
      sort: 'rating',
    });
    expect(page.items.map((i) => i.name)).toEqual(['Lux', 'Mid']);
  });
});

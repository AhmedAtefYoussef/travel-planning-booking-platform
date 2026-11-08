import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { REFERENCE_SERVICE, ReferenceService } from '../src/common/contracts';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { Country } from '../src/modules/reference/schemas/country.schema';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/** GEN-12: the official datasets seed idempotently and are served read-only to guests. */
describe('Reference data (e2e): GEN-12', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
  });

  afterAll(async () => {
    await app.close();
  });

  it('seeding again inserts nothing new (idempotent)', async () => {
    const again = await app
      .get(ReferenceSeedService)
      .seed(loadReferenceDataset(DATA_DIR));
    expect(again.countries).toEqual({ total: 8, inserted: 0, updated: 0 });
    expect(again.airports).toEqual({ total: 8, inserted: 0, updated: 0 });
    expect(again.currencies).toEqual({ total: 7, inserted: 0, updated: 0 });
  });

  it('seeding again restores a record that drifted from the dataset, counting it as updated', async () => {
    const countries = app.get<Model<Country>>(getModelToken(Country.name));
    await countries.updateOne(
      { code: 'EG' },
      { $set: { name: 'Egypt (edited)' } },
    );
    const again = await app
      .get(ReferenceSeedService)
      .seed(loadReferenceDataset(DATA_DIR));
    expect(again.countries).toEqual({ total: 8, inserted: 0, updated: 1 });
    await expect(
      countries.findOne({ code: 'EG' }).lean().exec(),
    ).resolves.toMatchObject({ name: 'Egypt' });
  });

  it('GET /api/countries is public and returns the seeded countries by name', async () => {
    const res = await http().get('/api/countries').expect(200);
    expect(res.body).toMatchObject({
      page: 1,
      limit: 10,
      total: 8,
      totalPages: 1,
    });
    expect(res.body.items[0]).toEqual({
      code: 'EG',
      name: 'Egypt',
      currency: 'EGP',
    });
    expect(res.body.items.map((c: { name: string }) => c.name)).toEqual(
      [...res.body.items.map((c: { name: string }) => c.name)].sort(),
    );
  });

  it('GET /api/cities filters by country code, case-insensitively', async () => {
    const res = await http().get('/api/cities?countryCode=ae').expect(200);
    expect(res.body.items).toEqual([
      { cityId: 'dubai', name: 'Dubai', countryCode: 'AE' },
    ]);
  });

  it('GET /api/cities returns an empty page for a country with no cities', async () => {
    const res = await http().get('/api/cities?countryCode=IT').expect(200);
    expect(res.body).toMatchObject({ items: [], total: 0, totalPages: 0 });
  });

  it('GET /api/cities rejects a malformed country code with a field error', async () => {
    const res = await http().get('/api/cities?countryCode=EGY').expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.fieldErrors[0].field).toBe('countryCode');
  });

  it('GET /api/currencies lists the 7 distinct currencies of Countries.csv', async () => {
    const res = await http().get('/api/currencies').expect(200);
    expect(res.body.items.map((c: { code: string }) => c.code)).toEqual([
      'AED',
      'EGP',
      'EUR',
      'GBP',
      'JPY',
      'SAR',
      'USD',
    ]);
    expect(res.body.items[4]).toEqual({
      code: 'JPY',
      name: 'Japanese Yen',
      minorUnits: 0,
    });
  });

  it('rejects a page-size parameter (GEN-05)', async () => {
    await http().get('/api/countries?limit=50').expect(400);
  });

  it('REFERENCE_SERVICE serves other modules, with case-insensitive codes', async () => {
    const reference = app.get<ReferenceService>(REFERENCE_SERVICE);
    await expect(reference.getAirport('cai')).resolves.toEqual({
      iataCode: 'CAI',
      name: 'Cairo International Airport',
      cityId: 'cairo',
      countryCode: 'EG',
      timeZone: 'Africa/Cairo',
    });
    await expect(reference.getAirport('XXX')).resolves.toBeNull();
    await expect(reference.getCountry('fr')).resolves.toMatchObject({
      currency: 'EUR',
    });
    await expect(reference.getCity('new_york')).resolves.toMatchObject({
      countryCode: 'US',
    });
    expect(await reference.listAirports()).toHaveLength(8);
    expect(await reference.listCities('DE')).toEqual([
      { cityId: 'frankfurt', name: 'Frankfurt', countryCode: 'DE' },
    ]);
    expect(await reference.listCountries()).toHaveLength(8);
    expect(await reference.listAttractions('paris')).toEqual([
      { attractionId: 'att-5', name: 'Louvre Museum', cityId: 'paris' },
    ]);
  });
});

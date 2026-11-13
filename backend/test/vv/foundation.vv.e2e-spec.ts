/**
 * V&V track D (foundation, reference data, API contract): GEN-02, GEN-05, GEN-12, GEN-13 and the
 * Swagger contract seen by an evaluator. Cases already covered by test/common-layer, diagnostics,
 * reference, contracts-schemas and users-schemas specs are not repeated here.
 * Defects are asserted as the CORRECT behaviour inside it.failing (see docs/qa/vv-m1/rtm-foundation.md).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication, RequestMethod, Type } from '@nestjs/common';
import {
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { getMetadataStorage } from 'class-validator';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  IS_PUBLIC_KEY,
  ROLES_KEY,
} from '../../src/common/auth/auth.decorators';
import { Role } from '../../src/common/auth/auth.types';
import { AppException } from '../../src/common/errors/app.exception';
import { createValidationPipe } from '../../src/common/pipes/validation.pipe';
import { buildOpenApiDocument } from '../../src/common/swagger/swagger.setup';
import { validateEnv } from '../../src/config/env.validation';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../../src/modules/reference';
import { Airport } from '../../src/modules/reference/schemas/airport.schema';
import { Attraction } from '../../src/modules/reference/schemas/attraction.schema';
import { City } from '../../src/modules/reference/schemas/city.schema';
import { Country } from '../../src/modules/reference/schemas/country.schema';
import { Currency } from '../../src/modules/reference/schemas/currency.schema';
import { User } from '../../src/modules/users';
import { loginAs } from '../support/auth';
import { createTestApp } from '../support/create-test-app';

const BACKEND = join(__dirname, '..', '..');
const DATA_DIR = join(BACKEND, 'seed', 'data');

/** The official mock records (brief section 5.1), exactly as published. */
const COUNTRIES = [
  { code: 'EG', name: 'Egypt', currency: 'EGP' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
  { code: 'US', name: 'United States', currency: 'USD' },
  { code: 'FR', name: 'France', currency: 'EUR' },
  { code: 'DE', name: 'Germany', currency: 'EUR' },
  { code: 'JP', name: 'Japan', currency: 'JPY' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR' },
];
const CITIES = [
  { cityId: 'cairo', name: 'Cairo', countryCode: 'EG' },
  { cityId: 'dubai', name: 'Dubai', countryCode: 'AE' },
  { cityId: 'london', name: 'London', countryCode: 'GB' },
  { cityId: 'new_york', name: 'New York', countryCode: 'US' },
  { cityId: 'paris', name: 'Paris', countryCode: 'FR' },
  { cityId: 'tokyo', name: 'Tokyo', countryCode: 'JP' },
  { cityId: 'riyadh', name: 'Riyadh', countryCode: 'SA' },
  { cityId: 'frankfurt', name: 'Frankfurt', countryCode: 'DE' },
];
const AIRPORTS = [
  ['CAI', 'Cairo International Airport', 'cairo', 'EG', 'Africa/Cairo'],
  ['DXB', 'Dubai International Airport', 'dubai', 'AE', 'Asia/Dubai'],
  ['LHR', 'Heathrow Airport', 'london', 'GB', 'Europe/London'],
  [
    'JFK',
    'John F. Kennedy International Airport',
    'new_york',
    'US',
    'America/New_York',
  ],
  ['CDG', 'Charles de Gaulle Airport', 'paris', 'FR', 'Europe/Paris'],
  ['HND', 'Haneda Airport', 'tokyo', 'JP', 'Asia/Tokyo'],
  ['RUH', 'King Khalid International Airport', 'riyadh', 'SA', 'Asia/Riyadh'],
  ['FRA', 'Frankfurt Airport', 'frankfurt', 'DE', 'Europe/Berlin'],
].map(([iataCode, name, cityId, countryCode, timeZone]) => ({
  iataCode,
  name,
  cityId,
  countryCode,
  timeZone,
}));
const ATTRACTIONS = [
  ['att-1', 'Giza Pyramids and Sphinx', 'cairo'],
  ['att-2', 'Burj Khalifa Observation Deck', 'dubai'],
  ['att-3', 'British Museum', 'london'],
  ['att-4', 'Central Park', 'new_york'],
  ['att-5', 'Louvre Museum', 'paris'],
  ['att-6', 'Senso-ji Temple', 'tokyo'],
  ['att-7', 'Kingdom Centre Tower (Sky Bridge)', 'riyadh'],
  ['att-8', 'Römerberg', 'frankfurt'],
].map(([attractionId, name, cityId]) => ({ attractionId, name, cityId }));
/** Supported currencies = the distinct currencies of Countries.csv, with ISO 4217 minor units. */
const CURRENCY_DIGITS: Record<string, number> = {
  AED: 2,
  EGP: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  SAR: 2,
  USD: 2,
};

/** MongoDB sorts strings by binary code point, which is what `<` does. */
const byKey =
  <T>(key: keyof T) =>
  (a: T, b: T) =>
    a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;

const ENVELOPE_KEYS = [
  'statusCode',
  'error',
  'code',
  'message',
  'fieldErrors',
  'path',
  'timestamp',
];

/** GEN-02: the single error envelope, with nothing internal in it. */
function expectEnvelope(
  res: request.Response,
  status: number,
  code: string,
  path: string,
): void {
  expect(res.status).toBe(status);
  const body = res.body as Record<string, unknown>;
  expect(Object.keys(body).filter((k) => !ENVELOPE_KEYS.includes(k))).toEqual(
    [],
  );
  expect(body).toMatchObject({ statusCode: status, code, path });
  expect(typeof body.error).toBe('string');
  expect(typeof body.message).toBe('string');
  expect((body.message as string).length).toBeGreaterThan(0);
  expect(new Date(body.timestamp as string).toISOString()).toBe(body.timestamp);
  if ('fieldErrors' in body) {
    expect(Array.isArray(body.fieldErrors)).toBe(true);
    for (const fe of body.fieldErrors as Record<string, unknown>[]) {
      expect(Object.keys(fe).sort()).toEqual(['field', 'message']);
    }
  }
  expect(JSON.stringify(body)).not.toMatch(
    /stack|node_modules|\.ts:\d|E11000|MongoServerError|CastError|at [A-Z]\w+\./,
  );
}

interface RouteInfo {
  controller: Type<unknown>;
  handlerName: string;
  handler: (...args: unknown[]) => unknown;
  method: string;
  path: string;
}

/** Every HTTP route registered in the running app, read from Nest's own metadata. */
function listRoutes(app: INestApplication): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const controller = wrapper.metatype as Type<unknown> | null;
      if (!controller) continue;
      const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
      const proto = controller.prototype as Record<string, unknown>;
      for (const handlerName of Object.getOwnPropertyNames(proto)) {
        const handler = proto[handlerName];
        if (handlerName === 'constructor' || typeof handler !== 'function')
          continue;
        const sub = Reflect.getMetadata(PATH_METADATA, handler) as
          string | undefined;
        if (sub === undefined) continue;
        const method = Reflect.getMetadata(
          METHOD_METADATA,
          handler,
        ) as RequestMethod;
        const path = `/api/${[base, sub]
          .filter((p) => p && p !== '/')
          .join('/')}`.replace(/\/+$/, '');
        routes.push({
          controller,
          handlerName,
          handler: handler as (...args: unknown[]) => unknown,
          method: RequestMethod[method],
          path,
        });
      }
    }
  }
  return routes;
}

describe('Reference data equals the official records (vv): GEN-12', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
  });

  afterAll(async () => {
    await app.close();
  });

  it('seeding a second time changes nothing in any of the five collections', async () => {
    const models = {
      countries: app.get<Model<Country>>(getModelToken(Country.name)),
      cities: app.get<Model<City>>(getModelToken(City.name)),
      airports: app.get<Model<Airport>>(getModelToken(Airport.name)),
      attractions: app.get<Model<Attraction>>(getModelToken(Attraction.name)),
      currencies: app.get<Model<Currency>>(getModelToken(Currency.name)),
    };
    const count = async () =>
      Object.fromEntries(
        await Promise.all(
          Object.entries(models).map(
            async ([k, m]) =>
              [k, await (m as Model<unknown>).countDocuments()] as const,
          ),
        ),
      );
    const before = await count();
    const again = await app
      .get(ReferenceSeedService)
      .seed(loadReferenceDataset(DATA_DIR));
    expect(again).toEqual({
      countries: { total: 8, inserted: 0, updated: 0 },
      currencies: { total: 7, inserted: 0, updated: 0 },
      cities: { total: 8, inserted: 0, updated: 0 },
      airports: { total: 8, inserted: 0, updated: 0 },
      attractions: { total: 8, inserted: 0, updated: 0 },
    });
    expect(await count()).toEqual(before);
    expect(before).toEqual({
      countries: 8,
      cities: 8,
      airports: 8,
      attractions: 8,
      currencies: 7,
    });
  });

  it('GET /api/countries returns exactly the 8 official countries', async () => {
    const res = await http().get('/api/countries').expect(200);
    expect(res.body).toEqual({
      items: [...COUNTRIES].sort(byKey('name')),
      page: 1,
      limit: 10,
      total: 8,
      totalPages: 1,
    });
  });

  it('GET /api/cities returns exactly the 8 official cities', async () => {
    const res = await http().get('/api/cities').expect(200);
    expect(res.body).toEqual({
      items: [...CITIES].sort(byKey('name')),
      page: 1,
      limit: 10,
      total: 8,
      totalPages: 1,
    });
  });

  it('GET /api/airports returns exactly the 8 official airports with their IANA zones', async () => {
    const res = await http().get('/api/airports').expect(200);
    expect(res.body).toEqual({
      items: [...AIRPORTS].sort(byKey('iataCode')),
      page: 1,
      limit: 10,
      total: 8,
      totalPages: 1,
    });
  });

  it('GET /api/currencies returns the 7 distinct currencies of the official countries', async () => {
    const res = await http().get('/api/currencies').expect(200);
    const items = res.body.items as {
      code: string;
      name: string;
      minorUnits: number;
    }[];
    expect(items.map(({ code, minorUnits }) => ({ code, minorUnits }))).toEqual(
      Object.entries(CURRENCY_DIGITS).map(([code, minorUnits]) => ({
        code,
        minorUnits,
      })),
    );
    expect(new Set(COUNTRIES.map((c) => c.currency))).toEqual(
      new Set(items.map((c) => c.code)),
    );
    for (const c of items) expect(c.name.length).toBeGreaterThan(0);
  });

  it('stores the 8 official attractions, with the UTF-8 "ö" of Römerberg intact', async () => {
    const attractions = app.get<Model<Attraction>>(
      getModelToken(Attraction.name),
    );
    const stored = await attractions
      .find({}, { _id: 0, attractionId: 1, name: 1, cityId: 1 })
      .sort({ attractionId: 1 })
      .lean()
      .exec();
    expect(stored).toEqual(ATTRACTIONS);
    const roemer = stored.find((a) => a.attractionId === 'att-8');
    expect(roemer?.name).toBe('Römerberg');
    expect(roemer?.name.normalize('NFC')).toBe(roemer?.name);
    const csv = readFileSync(join(DATA_DIR, 'Attractions.csv'));
    expect(csv.includes(Buffer.from([0x52, 0xc3, 0xb6]))).toBe(true);
    expect(csv.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(
      false,
    );
  });
});

describe('Single error envelope on every status (vv): GEN-02', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const someId = () => new Types.ObjectId().toHexString();
  const email = () => `vv.gen02.${someId()}@example.com`;

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
  });

  afterAll(async () => {
    await app.close();
  });

  it('400 VALIDATION_FAILED on a real route names every field', async () => {
    const res = await http().post('/api/auth/register').send({});
    expectEnvelope(res, 400, 'VALIDATION_FAILED', '/api/auth/register');
    expect(
      new Set(
        (res.body.fieldErrors as { field: string }[]).map((f) => f.field),
      ),
    ).toEqual(new Set(['name', 'email', 'password', 'acceptTerms']));
  });

  it('400 uses dotted/indexed paths for nested fields and unknown nested properties', async () => {
    const airlineId = someId();
    const res = await http()
      .put(`/api/airlines/${airlineId}/cancellation-policy`)
      .set('x-dev-user', `AIRLINE_MODERATOR:${someId()}:${airlineId}`)
      .send({
        tiers: [
          { daysBefore: 1, refundPercent: 10 },
          { daysBefore: 'x', refundPercent: 120, extra: true },
        ],
      });
    expectEnvelope(
      res,
      400,
      'VALIDATION_FAILED',
      `/api/airlines/${airlineId}/cancellation-policy`,
    );
    expect(
      new Set(
        (res.body.fieldErrors as { field: string }[]).map((f) => f.field),
      ),
    ).toEqual(
      new Set([
        'tiers[1].extra',
        'tiers[1].daysBefore',
        'tiers[1].refundPercent',
      ]),
    );
  });

  it('400 for a JSON array or text body instead of a 500', async () => {
    const arr = await http()
      .post('/api/auth/login')
      .send([{ a: 1 }]);
    expectEnvelope(arr, 400, 'VALIDATION_FAILED', '/api/auth/login');
    const text = await http()
      .post('/api/auth/login')
      .set('Content-Type', 'text/plain')
      .send('hello');
    expectEnvelope(text, 400, 'VALIDATION_FAILED', '/api/auth/login');
  });

  it('400 BAD_REQUEST for a malformed JSON body on a real route', async () => {
    const res = await http()
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expectEnvelope(res, 400, 'BAD_REQUEST', '/api/auth/login');
  });

  // F-D-01: a malformed JSON body returns the raw JSON.parse text (and echoes a non-object body).
  it.failing(
    'malformed JSON gets the generic message, never parser text or the request body',
    async () => {
      for (const raw of ['"Travel2026x"', '{"password": "Travel2026x" x}']) {
        const res = await http()
          .post('/api/auth/login')
          .set('Content-Type', 'application/json')
          .send(raw);
        expectEnvelope(res, 400, 'BAD_REQUEST', '/api/auth/login');
        expect(res.body.message).toBe('Malformed JSON request body');
        expect(res.body.message).not.toContain('Travel2026x');
      }
    },
  );

  it('400 INVALID_ID for a malformed path id on a real route', async () => {
    const res = await http().get('/api/airlines/not-an-id');
    expectEnvelope(res, 400, 'INVALID_ID', '/api/airlines/not-an-id');
    expect(res.body.fieldErrors).toEqual([
      {
        field: 'id',
        message: 'id must be a 24-character hexadecimal ObjectId',
      },
    ]);
  });

  it('401 without a session and with a forged cookie', async () => {
    expectEnvelope(
      await http().get('/api/auth/me'),
      401,
      'UNAUTHENTICATED',
      '/api/auth/me',
    );
    expectEnvelope(
      await http().get('/api/auth/me').set('Cookie', 'access_token=forged'),
      401,
      'UNAUTHENTICATED',
      '/api/auth/me',
    );
  });

  it('403 for a real traveller session on an admin route', async () => {
    const user = await loginAs(app, Role.User);
    const res = await http()
      .post('/api/airlines')
      .set('Cookie', user.cookie)
      .send({ name: 'Forbidden Air', code: 'FB' });
    expectEnvelope(res, 403, 'FORBIDDEN', '/api/airlines');
  });

  it('404 for an unknown route and for unknown ids, without echoing the query string', async () => {
    expectEnvelope(
      await http().get('/api/no-such-route?token=secret'),
      404,
      'NOT_FOUND',
      '/api/no-such-route',
    );
    const id = someId();
    expectEnvelope(
      await http().get(`/api/airlines/${id}`),
      404,
      'NOT_FOUND',
      `/api/airlines/${id}`,
    );
    expectEnvelope(
      await http().get(`/api/flights/${id}`),
      404,
      'NOT_FOUND',
      `/api/flights/${id}`,
    );
  });

  it('409 for a duplicate on a real route', async () => {
    const body = {
      name: 'Dup User',
      email: email(),
      password: 'Travel2026',
      acceptTerms: true,
    };
    await http().post('/api/auth/register').send(body).expect(201);
    const res = await http().post('/api/auth/register').send(body);
    expect(res.status).toBe(409);
    expectEnvelope(res, 409, res.body.code as string, '/api/auth/register');
  });

  it('413 PAYLOAD_TOO_LARGE for an oversized body', async () => {
    const res = await http()
      .post('/api/auth/login')
      .send({ email: email(), password: 'x'.repeat(200_000) });
    expectEnvelope(res, 413, 'PAYLOAD_TOO_LARGE', '/api/auth/login');
  });
});

describe('Fixed page size of 10 on every list (vv): GEN-05', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const ROUTE = { from: 'RUH', to: 'CDG', date: '2028-02-29' };

  /** Every list endpoint in the app, with what it needs to answer 200. */
  const LISTS: { url: string; headers?: Record<string, string> }[] = [
    { url: '/api/countries?' },
    { url: '/api/cities?' },
    { url: '/api/airports?' },
    { url: '/api/currencies?' },
    { url: '/api/admin/accounts?', headers: { 'x-dev-user': 'ADMIN' } },
    {
      url: `/api/flights/search?from=${ROUTE.from}&to=${ROUTE.to}&departureDate=${ROUTE.date}&passengers=1&`,
    },
    { url: '/api/diagnostics/rows?' },
  ];

  const get = (url: string, headers: Record<string, string> = {}) =>
    http().get(url).set(headers);

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
  });

  afterAll(async () => {
    await app.close();
  });

  it('the paginated routes are exactly the documented ones', () => {
    const doc = buildOpenApiDocument(app);
    const paginated = Object.entries(doc.paths)
      .filter(([, item]) =>
        (item.get?.parameters ?? []).some(
          (p) => 'name' in p && p.name === 'page',
        ),
      )
      .map(([path]) => path)
      .sort();
    expect(paginated).toEqual(LISTS.map((l) => l.url.split('?')[0]).sort());
  });

  async function expectTwoPages(
    url: string,
    key: string,
    headers: Record<string, string> = {},
  ): Promise<void> {
    const first = await get(`${url}page=1`, headers).expect(200);
    const second = await get(`${url}page=2`, headers).expect(200);
    expect(first.body).toMatchObject({
      page: 1,
      limit: 10,
      total: 11,
      totalPages: 2,
    });
    expect(first.body.items).toHaveLength(10);
    expect(second.body).toMatchObject({ page: 2, limit: 10, total: 11 });
    expect(second.body.items).toHaveLength(1);
    const keys = [...first.body.items, ...second.body.items].map(
      (i: Record<string, unknown>) => JSON.stringify(i[key]),
    );
    expect(new Set(keys).size).toBe(11);
  }

  it.each([
    [
      '/api/countries?',
      Country.name,
      'code',
      ['XA', 'XB', 'XC'].map((code, i) => ({
        code,
        name: `Vv Country ${i}`,
        currency: 'USD',
      })),
    ],
    [
      '/api/cities?',
      City.name,
      'cityId',
      [1, 2, 3].map((i) => ({
        cityId: `vv_city_${i}`,
        name: `Vv City ${i}`,
        countryCode: 'EG',
      })),
    ],
    [
      '/api/airports?',
      Airport.name,
      'iataCode',
      ['XAA', 'XAB', 'XAC'].map((iataCode) => ({
        iataCode,
        name: `Vv ${iataCode}`,
        cityId: 'cairo',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      })),
    ],
    [
      '/api/currencies?',
      Currency.name,
      'code',
      ['CHF', 'CAD', 'AUD', 'NZD'].map((code) => ({
        code,
        name: code,
        minorUnits: 2,
      })),
    ],
  ])('%s serves 11 rows as 10 + 1', async (url, modelName, key, extra) => {
    const model = app.get<Model<unknown>>(getModelToken(modelName));
    const keys = extra.map((e) => (e as Record<string, string>)[key]);
    try {
      await model.insertMany(extra);
      await expectTwoPages(url, key);
    } finally {
      await model.deleteMany({ [key]: { $in: keys } });
    }
  });

  it('/api/flights/search serves 11 matching flights as 10 + 1', async () => {
    let airline: request.Response | undefined;
    for (let attempt = 0; attempt < 5 && airline?.status !== 201; attempt++) {
      const code = `V${Math.floor(Math.random() * 90 + 10)}`;
      airline = await http()
        .post('/api/airlines')
        .set('x-dev-user', 'ADMIN')
        .send({ name: `VV Paging ${code}`, code });
    }
    expect(airline?.status).toBe(201);
    const moderator = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airline?.body.id as string}`;
    for (let i = 0; i < 11; i++) {
      const hh = String(6 + i).padStart(2, '0');
      const flight = await http()
        .post('/api/flights')
        .set('x-dev-user', moderator)
        .send({
          flightNumber: `VV${100 + i}`,
          from: ROUTE.from,
          to: ROUTE.to,
          departureLocal: `${ROUTE.date}T${hh}:00`,
          arrivalLocal: `${ROUTE.date}T${String(6 + i + 4).padStart(2, '0')}:00`,
        })
        .expect(201);
      await http()
        .post(`/api/flights/${flight.body.id as string}/cabins`)
        .set('x-dev-user', moderator)
        .send({
          class: 'ECONOMY',
          totalSeats: 10,
          priceMinor: 30000,
          freeBags: 1,
          maxKgPerBag: 23,
        })
        .expect(201);
    }
    await expectTwoPages(LISTS[5].url, 'flightId');
  });

  it.each(
    LISTS.flatMap((l) =>
      [
        'page=0',
        'page=-1',
        'page=abc',
        'page=1.5',
        'page=1&page=2',
        'limit=5',
        'pageSize=5',
        'per_page=5',
        'LIMIT=5',
      ].map((qs) => [l.url.split('?')[0], qs, l] as const),
    ),
  )('%s?%s is a 400 with a field error', async (_path, qs, list) => {
    const res = await get(`${list.url}${qs}`, list.headers);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.fieldErrors.length).toBeGreaterThan(0);
  });

  it.each(LISTS.map((l) => [l.url.split('?')[0], l] as const))(
    '%s beyond the last page is an empty page with the real total',
    async (_path, list) => {
      const res = await get(`${list.url}page=999`, list.headers).expect(200);
      expect(res.body).toMatchObject({ page: 999, limit: 10, items: [] });
      expect(res.body.total).toBeGreaterThanOrEqual(0);
      expect(res.body.totalPages).toBe(Math.ceil(res.body.total / 10));
    },
  );
});

describe('Backend enforcement and salted hashes (vv): GEN-13', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('every route declares @Public() or @Roles() explicitly, and the public ones are the reviewed list', () => {
    const routes = listRoutes(app);
    const undecided = routes.filter((r) => {
      const meta = (key: string): unknown =>
        (Reflect.getMetadata(key, r.handler) as unknown) ??
        (Reflect.getMetadata(key, r.controller) as unknown);
      return meta(IS_PUBLIC_KEY) === undefined && meta(ROLES_KEY) === undefined;
    });
    expect(undecided.map((r) => `${r.method} ${r.path}`)).toEqual([]);

    const isPublic = (r: RouteInfo) =>
      (Reflect.getMetadata(IS_PUBLIC_KEY, r.handler) as boolean | undefined) ??
      (Reflect.getMetadata(ROLES_KEY, r.handler) !== undefined
        ? false
        : Reflect.getMetadata(IS_PUBLIC_KEY, r.controller) === true);
    expect(
      routes
        .filter(isPublic)
        .map((r) => `${r.method} ${r.path}`)
        .sort(),
    ).toEqual(
      [
        'GET /api/health',
        'POST /api/auth/register',
        'POST /api/auth/login',
        'POST /api/auth/refresh',
        'POST /api/auth/logout',
        'GET /api/countries',
        'GET /api/cities',
        'GET /api/airports',
        'GET /api/currencies',
        'GET /api/airlines/:id',
        'GET /api/airlines/:id/cancellation-policy/refund-preview',
        'GET /api/flights/search',
        'GET /api/flights/:id',
        'POST /api/diagnostics/validation',
        'GET /api/diagnostics/rows',
        'POST /api/diagnostics/records',
        'GET /api/diagnostics/records/:id',
        'POST /api/diagnostics/password-hash',
      ].sort(),
    );
  });

  it('every @Body() and @Query() input is a validated DTO class (no unvalidated input)', () => {
    const BODY = 3;
    const QUERY = 4;
    const storage = getMetadataStorage();
    const unvalidated: string[] = [];
    for (const r of listRoutes(app)) {
      const args = (Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        r.controller,
        r.handlerName,
      ) ?? {}) as Record<
        string,
        { index: number; data?: unknown; pipes?: unknown[] }
      >;
      const types = (Reflect.getMetadata(
        'design:paramtypes',
        r.controller.prototype as object,
        r.handlerName,
      ) ?? []) as unknown[];
      for (const [key, arg] of Object.entries(args)) {
        const kind = Number(key.split(':')[0]);
        if (kind !== BODY && kind !== QUERY) continue;
        const metatype = types[arg.index] as Type<unknown> | undefined;
        const validated =
          arg.data === undefined &&
          typeof metatype === 'function' &&
          ![Object, String, Number, Boolean, Array].includes(
            metatype as never,
          ) &&
          storage.getTargetValidationMetadatas(metatype, '', true, false)
            .length > 0;
        if (!validated && !(arg.pipes ?? []).length) {
          unvalidated.push(`${r.method} ${r.path} arg ${arg.index}`);
        }
      }
    }
    expect(unvalidated).toEqual([]);
  });

  it('the same password registered twice gets two different salted bcrypt hashes, never returned', async () => {
    const users = app.get<Model<User>>(getModelToken(User.name));
    const password = 'SamePass2026';
    const ids: string[] = [];
    const bodies: unknown[] = [];
    for (let i = 0; i < 2; i++) {
      const email = `vv.gen13.${new Types.ObjectId().toHexString()}@example.com`;
      const reg = await http()
        .post('/api/auth/register')
        .send({ name: 'Same Pass', email, password, acceptTerms: true })
        .expect(201);
      ids.push(reg.body.id as string);
      const login = await http()
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);
      const cookie = (login.headers['set-cookie'] as unknown as string[])
        .find((c) => c.startsWith('access_token='))!
        .split(';')[0];
      const me = await http().get('/api/auth/me').set('Cookie', cookie);
      const profile = await http().get('/api/users/me').set('Cookie', cookie);
      bodies.push(reg.body, login.body, me.body, profile.body);
    }
    const admin = await loginAs(app, Role.Admin);
    const accounts = await http()
      .get('/api/admin/accounts?q=vv.gen13')
      .set('Cookie', admin.cookie)
      .expect(200);
    bodies.push(accounts.body);

    const stored = await users
      .find({ _id: { $in: ids } })
      .select('+passwordHash')
      .lean()
      .exec();
    const [a, b] = stored.map((u) => u.passwordHash);
    expect(a).not.toBe(b);
    for (const hash of [a, b]) {
      expect(hash).toMatch(/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/);
      expect(hash).not.toContain(password);
      expect(await bcrypt.compare(password, hash)).toBe(true);
    }
    expect(JSON.stringify(bodies)).not.toMatch(
      /passwordHash|\$2[aby]\$|SamePass2026/,
    );
  });

  it('the diagnostics module is not part of AppModule when NODE_ENV=production', () => {
    const original = process.env.NODE_ENV;
    const importsFor = (nodeEnv: string): string[] => {
      let names: string[] = [];
      jest.isolateModules(() => {
        // Keep ConfigModule from reading backend/.env: only the module list is inspected.
        jest.doMock('../../src/config/config.module', () => ({
          AppConfigModule: class AppConfigModule {},
        }));
        process.env.NODE_ENV = nodeEnv;
        const { AppModule } = jest.requireActual<{
          AppModule: Type<unknown>;
        }>('../../src/app.module');
        names = (
          (Reflect.getMetadata('imports', AppModule) ?? []) as {
            name?: string;
          }[]
        ).map((m) => m.name ?? '');
      });
      return names;
    };
    try {
      expect(importsFor('production')).not.toContain('DiagnosticsModule');
      expect(importsFor('development')).toContain('DiagnosticsModule');
      expect(importsFor('production')).toContain('ReferenceModule');
    } finally {
      process.env.NODE_ENV = original;
      jest.dontMock('../../src/config/config.module');
    }
  });

  describe('production configuration', () => {
    /** .env.example, the file every teammate copies to backend/.env. */
    const example = Object.fromEntries(
      readFileSync(join(BACKEND, '..', '.env.example'), 'utf8')
        .split(/\r?\n/)
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
    const hardened = {
      ...example,
      NODE_ENV: 'production',
      AUTH_STUB: 'false',
      COOKIE_SECURE: 'true',
      MONGODB_URI: 'mongodb://localhost:27017/prod',
      JWT_SECRET: 'a-real-production-secret-with-enough-entropy-123',
      STRIPE_SECRET_KEY: 'sk_test_51RealLookingKeyForProd',
      STRIPE_WEBHOOK_SECRET: 'whsec_RealLookingSecretForProd',
      FX_API_KEY: 'fx-real-key-123',
      ADMIN_SEED_PASSWORD: 'Unguessable!Admin2026',
    };

    it('accepts a hardened configuration and refuses AUTH_STUB=true or COOKIE_SECURE=false', () => {
      expect(() => validateEnv(hardened)).not.toThrow();
      expect(() => validateEnv({ ...hardened, AUTH_STUB: 'true' })).toThrow(
        /AUTH_STUB must be false/,
      );
      expect(() =>
        validateEnv({ ...hardened, COOKIE_SECURE: 'false' }),
      ).toThrow(/COOKIE_SECURE must be true/);
    });

    // F-D-02: the published admin password from .env.example passes the production placeholder check.
    it.failing(
      'refuses the .env.example ADMIN_SEED_PASSWORD placeholder in production',
      () => {
        expect(() =>
          validateEnv({
            ...hardened,
            ADMIN_SEED_PASSWORD: example.ADMIN_SEED_PASSWORD,
          }),
        ).toThrow(/ADMIN_SEED_PASSWORD/);
      },
    );
  });
});

describe('Swagger contract as an evaluator sees it (vv): GEN-02', () => {
  let app: INestApplication<App>;
  let doc: ReturnType<typeof buildOpenApiDocument>;
  const NEGATIVE = /^(invalid|rejected|fails)\b/i;

  interface Example {
    operation: string;
    name: string;
    summary: string;
    value: unknown;
    metatype?: Type<unknown>;
  }
  let examples: Example[];

  /** The DTO class behind each operationId ("Controller_method"). */
  function bodyTypes(): Map<string, Type<unknown>> {
    const map = new Map<string, Type<unknown>>();
    for (const r of listRoutes(app)) {
      const args = (Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        r.controller,
        r.handlerName,
      ) ?? {}) as Record<string, { index: number }>;
      const types = (Reflect.getMetadata(
        'design:paramtypes',
        r.controller.prototype as object,
        r.handlerName,
      ) ?? []) as Type<unknown>[];
      const body = Object.entries(args).find(([k]) => k.startsWith('3:'));
      if (body)
        map.set(`${r.controller.name}_${r.handlerName}`, types[body[1].index]);
    }
    return map;
  }

  async function dtoErrors(
    metatype: Type<unknown>,
    value: unknown,
  ): Promise<string[]> {
    try {
      await createValidationPipe().transform(value, {
        type: 'body',
        metatype,
      });
      return [];
    } catch (e) {
      if (!(e instanceof AppException)) throw e;
      return (e.fieldErrors ?? []).map((f) => `${f.field}: ${f.message}`);
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
    doc = buildOpenApiDocument(app);
    const types = bodyTypes();
    examples = [];
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(item) as [
        string,
        {
          operationId?: string;
          requestBody?: {
            content?: Record<
              string,
              {
                examples?: Record<string, { summary?: string; value: unknown }>;
              }
            >;
          };
        },
      ][]) {
        const content = op.requestBody?.content?.['application/json'];
        for (const [name, ex] of Object.entries(content?.examples ?? {})) {
          examples.push({
            operation: `${method.toUpperCase()} ${path}`,
            name,
            summary: ex.summary ?? '',
            value: ex.value,
            metatype: types.get(op.operationId ?? ''),
          });
        }
      }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('the committed backend/openapi.json is the contract the code generates', () => {
    const committed = readFileSync(join(BACKEND, 'openapi.json'), 'utf8');
    expect(JSON.parse(committed)).toEqual(
      JSON.parse(JSON.stringify(doc)) as unknown,
    );
  });

  it('every operation summary starts with a requirement ID', () => {
    const bad: string[] = [];
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(item) as [
        string,
        { summary?: string },
      ][]) {
        if (!/^(?:[A-Z]{3}-\d{2}[a-z]?|TRVL-\d+)\b/.test(op.summary ?? ''))
          bad.push(`${method} ${path}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every positive request example passes its own DTO validation (Try it out does not 400)', async () => {
    const failing: string[] = [];
    expect(examples.length).toBeGreaterThan(30);
    for (const ex of examples) {
      if (NEGATIVE.test(ex.summary)) continue;
      expect(ex.metatype).toBeDefined();
      const errors = await dtoErrors(ex.metatype!, ex.value);
      if (errors.length)
        failing.push(`${ex.operation} [${ex.name}] ${errors.join('; ')}`);
    }
    expect(failing).toEqual([]);
  });

  it('every negative ("Invalid"/"Rejected") example is rejected by its DTO or names a business rule', async () => {
    const accepted: string[] = [];
    for (const ex of examples) {
      if (!NEGATIVE.test(ex.summary)) continue;
      if ((await dtoErrors(ex.metatype!, ex.value)).length === 0)
        accepted.push(`${ex.operation} [${ex.name}]`);
    }
    // These pass the DTO on purpose: the service rejects them (FLT-03, FLT-05, FLT-09, HTL-04, ACC-04).
    expect(accepted.sort()).toEqual(
      [
        'PATCH /api/flights/{id} [invalid]',
        'POST /api/auth/login [wrongPassword]',
        'POST /api/flights [arrivalBeforeDeparture]',
        'POST /api/flights [inThePast]',
        'POST /api/flights [sameAirport]',
        'POST /api/flights [unknownAirport]',
        'POST /api/hotels/{id}/rooms/{roomId}/availability [overlapping]',
        'PUT /api/airlines/{id}/cancellation-policy [duplicate]',
      ].sort(),
    );
  });

  // F-D-03: the "Valid" flight examples depart on 2026-12-01, before the Milestone 2 evaluation.
  it.failing(
    'date-based "Valid" examples stay in the future through the Milestone 2 evaluation (2026-12-11)',
    () => {
      const m2 = Date.parse('2026-12-11T00:00:00Z');
      const create = examples.filter(
        (e) => e.operation === 'POST /api/flights' && !NEGATIVE.test(e.summary),
      );
      expect(create.length).toBeGreaterThan(0);
      for (const ex of create) {
        const { departureLocal } = ex.value as { departureLocal: string };
        expect(Date.parse(`${departureLocal}:00Z`)).toBeGreaterThan(m2);
      }
      const search = doc.paths['/api/flights/search'].get?.parameters?.find(
        (p) => 'name' in p && p.name === 'departureDate',
      ) as { schema?: { example?: string } } | undefined;
      expect(
        Date.parse(`${search?.schema?.example}T00:00:00Z`),
      ).toBeGreaterThan(m2);
    },
  );

  // F-D-04: the "Seeded admin" login example does not use the .env.example seed password.
  it.failing(
    'the "Seeded admin" login example matches ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD of .env.example',
    () => {
      const env = readFileSync(join(BACKEND, '..', '.env.example'), 'utf8');
      const value = (key: string) =>
        new RegExp(`^${key}=(.*)$`, 'm').exec(env)?.[1];
      const admin = examples.find(
        (e) => e.operation === 'POST /api/auth/login' && e.name === 'admin',
      );
      expect(admin?.value).toEqual({
        email: value('ADMIN_SEED_EMAIL'),
        password: value('ADMIN_SEED_PASSWORD'),
      });
    },
  );
});

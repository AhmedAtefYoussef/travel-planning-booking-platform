import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ProviderType, Role } from '../../src/common/auth/auth.types';
import { Airline, Flight, FlightStatus } from '../../src/modules/flights';
import { FlightStatusService } from '../../src/modules/flights/flight-status.service';
import { FlightsService } from '../../src/modules/flights/flights.service';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../../src/modules/reference';
import { loginAs } from '../support/auth';
import { createTestApp } from '../support/create-test-app';

/**
 * V&V track B (Flights, airlines, airports): FLT-01..FLT-30, GEN-06. Only rules that no existing spec
 * covers, and always through real cookie sessions: the admin creates the airline, then creates its
 * moderator through POST /api/admin/moderators, who logs in and changes the temporary password
 * before managing anything. Time is controlled by back-dating departureUtc or by passing `now`
 * to FlightStatusService.markDeparted, never with fake timers.
 */

const DATA_DIR = join(__dirname, '..', '..', 'seed', 'data');
const TEMP = 'Temp2026x';
const OWN = 'MyOwn2027';
const LOCAL = "yyyy-MM-dd'T'HH:mm";

let app: INestApplication<App>;
let flights: Model<Flight>;
let airlines: Model<Airline>;
let adminCookie: string;
let userCookie: string;
const http = () => request(app.getHttpServer());

const cookieOf = (res: request.Response): string =>
  (res.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('access_token='))!
    .split(';')[0];

/** Distinct field names in a 400 body (one field may carry several messages). */
const fieldsOf = (res: request.Response): string[] =>
  [
    ...new Set(
      (res.body.fieldErrors as { field: string }[]).map((f) => f.field),
    ),
  ].sort();

async function newAirline(code: string): Promise<string> {
  const res = await http()
    .post('/api/airlines')
    .set('Cookie', adminCookie)
    .send({ name: `VV Air ${code}`, code })
    .expect(201);
  return res.body.id as string;
}

/** ACC-13 flow: admin creates the moderator, who logs in and replaces the temporary password. */
async function newModerator(airlineId: string): Promise<string> {
  const email = `vv.flt.${new Types.ObjectId().toHexString()}@example.com`;
  await http()
    .post('/api/admin/moderators')
    .set('Cookie', adminCookie)
    .send({
      name: 'VV Ops',
      email,
      role: 'AIRLINE_MODERATOR',
      providerId: airlineId,
      temporaryPassword: TEMP,
    })
    .expect(201);
  const login = await http()
    .post('/api/auth/login')
    .send({ email, password: TEMP })
    .expect(200);
  const cookie = cookieOf(login);
  await http()
    .patch('/api/auth/change-password')
    .set('Cookie', cookie)
    .send({ currentPassword: TEMP, newPassword: OWN })
    .expect(204);
  return cookie;
}

async function airlineWithModerator(
  code: string,
): Promise<{ id: string; cookie: string }> {
  const id = await newAirline(code);
  return { id, cookie: await newModerator(id) };
}

interface FlightInput {
  flightNumber: string;
  from: string;
  to: string;
  departureLocal: string;
  arrivalLocal: string;
}

const createFlight = (cookie: string, body: object) =>
  http().post('/api/flights').set('Cookie', cookie).send(body);

async function flightId(cookie: string, body: FlightInput): Promise<string> {
  return (await createFlight(cookie, body).expect(201)).body.id as string;
}

const ECONOMY = {
  class: 'ECONOMY',
  totalSeats: 10,
  priceMinor: 20000,
  freeBags: 1,
  maxKgPerBag: 23,
};

const addCabin = (cookie: string, id: string, cabin: object = ECONOMY) =>
  http().post(`/api/flights/${id}/cabins`).set('Cookie', cookie).send(cabin);

const search = (q: Record<string, string | number>) =>
  http().get('/api/flights/search').query(q);

const numbersOf = (res: request.Response): string[] =>
  (res.body.items as { flightNumber: string }[]).map((i) => i.flightNumber);

beforeAll(async () => {
  app = await createTestApp();
  await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
  flights = app.get<Model<Flight>>(getModelToken(Flight.name));
  airlines = app.get<Model<Airline>>(getModelToken(Airline.name));
  adminCookie = (await loginAs(app, Role.Admin)).cookie;
  userCookie = (await loginAs(app, Role.User)).cookie;
});

afterAll(async () => {
  await app.close();
});

describe('Airline profiles with real sessions (vv): FLT-01', () => {
  let a: { id: string; cookie: string };
  let b: { id: string; cookie: string };

  beforeAll(async () => {
    a = await airlineWithModerator('V1A');
    b = await airlineWithModerator('V1B');
  });

  it('only an admin creates an airline; guest 401, user and moderator 403, nothing created', async () => {
    const body = { name: 'Denied Air', code: 'V1X' };
    await http().post('/api/airlines').send(body).expect(401);
    await http()
      .post('/api/airlines')
      .set('Cookie', userCookie)
      .send(body)
      .expect(403);
    await http()
      .post('/api/airlines')
      .set('Cookie', a.cookie)
      .send(body)
      .expect(403);
    expect(await airlines.countDocuments({ code: 'V1X' })).toBe(0);
    await http()
      .post('/api/airlines')
      .set('Cookie', adminCookie)
      .send(body)
      .expect(201);
  });

  it('codes are unique whatever the case or spaces (409), on create, edit and in a race', async () => {
    const created = await http()
      .post('/api/airlines')
      .set('Cookie', adminCookie)
      .send({ name: 'Lower Air', code: 'v1y' })
      .expect(201);
    expect(created.body.code).toBe('V1Y');
    for (const code of [' V1Y ', 'V1y']) {
      const res = await http()
        .post('/api/airlines')
        .set('Cookie', adminCookie)
        .send({ name: 'Clash Air', code })
        .expect(409);
      expect(res.body.code).toBe('DUPLICATE_KEY');
    }
    // Editing A's code to another airline's code (lower case) is refused and A keeps its code.
    await http()
      .patch(`/api/airlines/${a.id}`)
      .set('Cookie', a.cookie)
      .send({ code: 'v1b' })
      .expect(409);
    expect((await airlines.findById(a.id).lean())?.code).toBe('V1A');

    const race = await Promise.all(
      [0, 1].map(() =>
        http()
          .post('/api/airlines')
          .set('Cookie', adminCookie)
          .send({ name: 'Race Air', code: 'V1R' }),
      ),
    );
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await airlines.countDocuments({ code: 'V1R' })).toBe(1);
  });

  it("a moderator edits only their own airline; another airline's edit is 403 and changes nothing", async () => {
    const own = await http()
      .patch(`/api/airlines/${a.id}`)
      .set('Cookie', a.cookie)
      .send({
        name: 'VV Air A Renamed',
        logoUrl: 'https://cdn.example.com/a.png',
      })
      .expect(200);
    expect(own.body).toMatchObject({
      name: 'VV Air A Renamed',
      code: 'V1A',
      logoUrl: 'https://cdn.example.com/a.png',
    });

    const before = await airlines.findById(b.id).lean();
    for (const body of [
      { name: 'Hijacked' },
      { code: 'V1H' },
      { logoUrl: 'https://evil.example.com/x.png' },
    ]) {
      await http()
        .patch(`/api/airlines/${b.id}`)
        .set('Cookie', a.cookie)
        .send(body)
        .expect(403);
    }
    // The real session wins over a stub header that claims the other airline (or admin).
    for (const stub of [
      `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${b.id}`,
      'ADMIN',
    ]) {
      await http()
        .patch(`/api/airlines/${b.id}`)
        .set('Cookie', a.cookie)
        .set('x-dev-user', stub)
        .send({ name: 'Stub Hijack' })
        .expect(403);
    }
    await http()
      .patch(`/api/airlines/${b.id}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Admin Edit' })
      .expect(403);
    await http()
      .patch(`/api/airlines/${b.id}`)
      .set('Cookie', userCookie)
      .send({ name: 'User Edit' })
      .expect(403);
    await http()
      .patch(`/api/airlines/${b.id}`)
      .send({ name: 'Guest Edit' })
      .expect(401);
    const after = await airlines.findById(b.id).lean();
    expect(after).toMatchObject({
      name: before?.name,
      code: before?.code,
      logoUrl: before?.logoUrl,
      isActive: true,
    });
  });

  it('isActive, policy and other unknown fields cannot be mass-assigned (400), on create or edit', async () => {
    const create = await http()
      .post('/api/airlines')
      .set('Cookie', adminCookie)
      .send({
        name: 'Mass Air',
        code: 'V1M',
        isActive: false,
        policy: { cancellationTiers: [] },
      })
      .expect(400);
    expect(create.body.code).toBe('VALIDATION_FAILED');
    expect(fieldsOf(create)).toEqual(['isActive', 'policy']);
    expect(await airlines.countDocuments({ code: 'V1M' })).toBe(0);

    for (const body of [
      { isActive: false },
      { policy: { extraBaggage: { pricePerBagMinor: 1 } } },
      { id: b.id },
    ]) {
      const res = await http()
        .patch(`/api/airlines/${a.id}`)
        .set('Cookie', a.cookie)
        .send(body)
        .expect(400);
      expect(fieldsOf(res)).toEqual(Object.keys(body));
    }
    const stored = await airlines.findById(a.id).lean();
    expect(stored?.isActive).toBe(true);
    expect(stored?.policy?.extraBaggage).toBeUndefined();
  });

  it('logoUrl accepts only http(s) links until GEN-08 uploads exist', async () => {
    for (const logoUrl of [
      'javascript:alert(1)',
      'ftp://cdn.example.com/a.png',
      'data:image/png;base64,iVBORw0KGgo=',
      '/uploads/a.png',
    ]) {
      const res = await http()
        .patch(`/api/airlines/${a.id}`)
        .set('Cookie', a.cookie)
        .send({ logoUrl })
        .expect(400);
      expect(fieldsOf(res)).toEqual(['logoUrl']);
    }
    expect((await airlines.findById(a.id).lean())?.logoUrl).toBe(
      'https://cdn.example.com/a.png',
    );
  });
});

describe('Airport list and airport checks (vv): FLT-02', () => {
  let mod: { id: string; cookie: string };

  beforeAll(async () => {
    mod = await airlineWithModerator('V2A');
  });

  it('lists each predefined airport with its exact IANA zone, city and country', async () => {
    const res = await http().get('/api/airports').expect(200);
    const rows = res.body.items as {
      iataCode: string;
      timeZone: string;
      cityId: string;
      countryCode: string;
      name: string;
    }[];
    expect(
      Object.fromEntries(rows.map((a) => [a.iataCode, a.timeZone])),
    ).toEqual({
      CAI: 'Africa/Cairo',
      CDG: 'Europe/Paris',
      DXB: 'Asia/Dubai',
      FRA: 'Europe/Berlin',
      HND: 'Asia/Tokyo',
      JFK: 'America/New_York',
      LHR: 'Europe/London',
      RUH: 'Asia/Riyadh',
    });
    for (const a of rows) {
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.cityId.length).toBeGreaterThan(0);
      expect(a.countryCode).toMatch(/^[A-Z]{2}$/);
    }
    // GEN-05: fixed page size, no client-chosen limit.
    const limit = await http().get('/api/airports?limit=50').expect(400);
    expect(fieldsOf(limit)).toEqual(['limit']);
  });

  it('flight creation accepts only listed airports, in any letter case', async () => {
    const base = {
      flightNumber: 'V2100',
      departureLocal: '2027-12-09T10:00',
      arrivalLocal: '2027-12-09T12:30',
    };
    const unknown = await createFlight(mod.cookie, {
      ...base,
      from: 'XXX',
      to: 'CDG',
    }).expect(400);
    expect(unknown.body.fieldErrors).toEqual([
      {
        field: 'from',
        message: 'Unknown airport "XXX" (see GET /api/airports)',
      },
    ]);
    const malformed = await createFlight(mod.cookie, {
      ...base,
      from: 'LHR',
      to: 'C1G',
    }).expect(400);
    expect(fieldsOf(malformed)).toEqual(['to']);
    const lower = await createFlight(mod.cookie, {
      ...base,
      from: 'lhr',
      to: 'cdg',
    }).expect(201);
    expect(lower.body.departure.airport).toBe('LHR');
    expect(lower.body.arrival.airport).toBe('CDG');
    expect(await flights.countDocuments({ flightNumber: 'V2100' })).toBe(1);
  });

  it('flight search accepts only listed airports, in any letter case', async () => {
    const unknown = await search({
      from: 'xxx',
      to: 'CDG',
      departureDate: '2027-12-09',
      passengers: 1,
    }).expect(400);
    expect(fieldsOf(unknown)).toEqual(['from']);
    const same = await search({
      from: 'LHR',
      to: 'lhr',
      departureDate: '2027-12-09',
      passengers: 1,
    }).expect(400);
    expect(fieldsOf(same)).toEqual(['to']);
    // The flight from the previous test has no cabins, so it is not an option yet.
    const id = (await flights.findOne({ flightNumber: 'V2100' }).lean())!._id;
    await addCabin(mod.cookie, id.toHexString()).expect(201);
    const lower = await search({
      from: 'lhr',
      to: 'cdg',
      departureDate: '2027-12-09',
      passengers: 1,
    }).expect(200);
    expect(numbersOf(lower)).toEqual(['V2100']);
  });
});

describe('Local-time flight creation (vv): FLT-03', () => {
  let mod: { id: string; cookie: string };
  let other: { id: string; cookie: string };

  beforeAll(async () => {
    mod = await airlineWithModerator('V3A');
    other = await airlineWithModerator('V3B');
  });

  // [airport, December offset, July offset] from the IANA rules, not from the code under test.
  const ZONES: [string, string, string][] = [
    ['CAI', '+02:00', '+03:00'],
    ['DXB', '+04:00', '+04:00'],
    ['LHR', '+00:00', '+01:00'],
    ['JFK', '-05:00', '-04:00'],
    ['CDG', '+01:00', '+02:00'],
    ['HND', '+09:00', '+09:00'],
    ['RUH', '+03:00', '+03:00'],
    ['FRA', '+01:00', '+02:00'],
  ];

  it.each(ZONES)(
    'converts 10:00 local at %s to UTC (December %s, July %s)',
    async (airport, winter, summer) => {
      for (const [date, offset] of [
        ['2027-12-10', winter],
        ['2027-07-10', summer],
      ]) {
        const res = await createFlight(mod.cookie, {
          flightNumber: `V3${airport}`,
          from: airport,
          to: airport === 'DXB' ? 'CAI' : 'DXB',
          departureLocal: `${date}T10:00`,
          arrivalLocal: `${DateTime.fromISO(date).plus({ days: 1 }).toISODate()!}T20:00`,
        }).expect(201);
        const expectedUtc = DateTime.fromISO(`${date}T10:00:00.000${offset}`, {
          setZone: true,
        })
          .toUTC()
          .toISO();
        expect(res.body.departure).toMatchObject({
          airport,
          utc: expectedUtc,
          local: `${date}T10:00:00.000${offset}`,
        });
        const stored = await flights.findById(res.body.id).lean();
        expect(stored?.departureUtc.toISOString()).toBe(expectedUtc);
      }
    },
  );

  it('rejects a local time skipped by the spring-forward change, at either airport', async () => {
    const gapDeparture = await createFlight(mod.cookie, {
      flightNumber: 'V3D1',
      from: 'LHR',
      to: 'CDG',
      departureLocal: '2027-03-28T01:30',
      arrivalLocal: '2027-03-28T06:00',
    }).expect(400);
    expect(gapDeparture.body.fieldErrors).toEqual([
      {
        field: 'departureLocal',
        message:
          '2027-03-28T01:30 does not exist in Europe/London (daylight-saving change) (LHR)',
      },
    ]);
    const gapArrival = await createFlight(mod.cookie, {
      flightNumber: 'V3D2',
      from: 'CDG',
      to: 'JFK',
      departureLocal: '2027-03-13T22:00',
      arrivalLocal: '2027-03-14T02:30',
    }).expect(400);
    expect(fieldsOf(gapArrival)).toEqual(['arrivalLocal']);
  });

  it('rejects a time in the repeated autumn hour (derived rule) and converts the hours around it', async () => {
    const repeated = await createFlight(mod.cookie, {
      flightNumber: 'V3D3',
      from: 'LHR',
      to: 'CDG',
      departureLocal: '2027-10-31T01:30',
      arrivalLocal: '2027-10-31T06:00',
    }).expect(400);
    expect(fieldsOf(repeated)).toEqual(['departureLocal']);
    expect(repeated.body.fieldErrors[0].message).toContain('occurs twice');

    const before = await createFlight(mod.cookie, {
      flightNumber: 'V3D4',
      from: 'LHR',
      to: 'CDG',
      departureLocal: '2027-10-31T00:30',
      arrivalLocal: '2027-10-31T06:00',
    }).expect(201);
    expect(before.body.departure).toMatchObject({
      utc: '2027-10-30T23:30:00.000Z',
      local: '2027-10-31T00:30:00.000+01:00',
    });
    expect(before.body.departureLocalDate).toBe('2027-10-31');
    const after = await createFlight(mod.cookie, {
      flightNumber: 'V3D5',
      from: 'LHR',
      to: 'CDG',
      departureLocal: '2027-10-31T02:30',
      arrivalLocal: '2027-10-31T06:00',
    }).expect(201);
    expect(after.body.departure).toMatchObject({
      utc: '2027-10-31T02:30:00.000Z',
      local: '2027-10-31T02:30:00.000+00:00',
    });
  });

  it('compares arrival and departure in UTC: equal instants are refused, a local time that looks earlier is accepted', async () => {
    // 17:00 Cairo and 19:00 Dubai are the same instant (15:00Z).
    const equal = await createFlight(mod.cookie, {
      flightNumber: 'V3U1',
      from: 'CAI',
      to: 'DXB',
      departureLocal: '2027-12-01T17:00',
      arrivalLocal: '2027-12-01T19:00',
    }).expect(400);
    expect(equal.body.fieldErrors).toEqual([
      {
        field: 'arrivalLocal',
        message: 'Arrival must be after departure (compared in UTC)',
      },
    ]);
    // 10:00 Dubai (06:00Z) to 09:00 Cairo (07:00Z): earlier on the clock, later in UTC.
    const westbound = await createFlight(mod.cookie, {
      flightNumber: 'V3U2',
      from: 'DXB',
      to: 'CAI',
      departureLocal: '2027-12-01T10:00',
      arrivalLocal: '2027-12-01T09:00',
    }).expect(201);
    expect(westbound.body.durationMinutes).toBe(60);
    // Across the date line: arrives on the previous local calendar day.
    const dateLine = await createFlight(mod.cookie, {
      flightNumber: 'V3U3',
      from: 'HND',
      to: 'JFK',
      departureLocal: '2027-12-02T10:00',
      arrivalLocal: '2027-12-01T23:00',
    }).expect(201);
    expect(dateLine.body).toMatchObject({
      durationMinutes: 180,
      departureLocalDate: '2027-12-02',
      departure: { utc: '2027-12-02T01:00:00.000Z' },
      arrival: { utc: '2027-12-02T04:00:00.000Z' },
    });
  });

  it('rejects a departure a few minutes in the past (airport-local clock)', async () => {
    const cairoNow = DateTime.now().setZone('Africa/Cairo');
    const res = await createFlight(mod.cookie, {
      flightNumber: 'V3P1',
      from: 'CAI',
      to: 'DXB',
      departureLocal: cairoNow.minus({ minutes: 5 }).toFormat(LOCAL),
      arrivalLocal: cairoNow.plus({ hours: 4 }).toFormat(LOCAL),
    }).expect(400);
    expect(res.body.fieldErrors).toEqual([
      { field: 'departureLocal', message: 'Departure must be in the future' },
    ]);
  });

  it('keys the duplicate-number rule on the LOCAL departure date, not the UTC date', async () => {
    const jfk = (flightNumber: string, dep: string, arr: string) => ({
      flightNumber,
      from: 'JFK',
      to: 'LHR',
      departureLocal: dep,
      arrivalLocal: arr,
    });
    // Same local date (1 Dec in New York), different UTC dates (1 Dec 13:00Z, 2 Dec 02:00Z): 409.
    await createFlight(
      mod.cookie,
      jfk('V3N1', '2027-12-01T08:00', '2027-12-01T20:00'),
    ).expect(201);
    const clash = await createFlight(
      mod.cookie,
      jfk('V3N1', '2027-12-01T21:00', '2027-12-02T09:00'),
    ).expect(409);
    expect(clash.body.code).toBe('DUPLICATE_KEY');
    // Different local dates (1 Dec 23:30, 2 Dec 00:30), same UTC date (2 Dec): both allowed.
    await createFlight(
      mod.cookie,
      jfk('V3N2', '2027-12-01T23:30', '2027-12-02T11:30'),
    ).expect(201);
    await createFlight(
      mod.cookie,
      jfk('V3N2', '2027-12-02T00:30', '2027-12-02T12:30'),
    ).expect(201);
    // Flight numbers compare in capitals; another airline may reuse the number that day.
    const lower = await createFlight(
      mod.cookie,
      jfk('v3n3', '2027-12-03T08:00', '2027-12-03T20:00'),
    ).expect(201);
    expect(lower.body.flightNumber).toBe('V3N3');
    await createFlight(
      mod.cookie,
      jfk('V3N3', '2027-12-03T18:00', '2027-12-04T06:00'),
    ).expect(409);
    await createFlight(
      other.cookie,
      jfk('V3N3', '2027-12-03T08:00', '2027-12-03T20:00'),
    ).expect(201);
    expect(
      await flights.countDocuments({
        airlineId: new Types.ObjectId(mod.id),
        flightNumber: 'V3N3',
      }),
    ).toBe(1);
  });

  it('parallel creates of the same number and local date store exactly one flight', async () => {
    const body = {
      flightNumber: 'V3R1',
      from: 'RUH',
      to: 'CAI',
      departureLocal: '2027-12-05T09:00',
      arrivalLocal: '2027-12-05T11:00',
    };
    const res = await Promise.all(
      [0, 1, 2].map(() => createFlight(mod.cookie, body)),
    );
    expect(res.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await flights.countDocuments({ flightNumber: 'V3R1' })).toBe(1);
  });

  it('only a real airline moderator session creates flights, always for their own airline', async () => {
    const body = {
      flightNumber: 'V3S1',
      from: 'CDG',
      to: 'FRA',
      departureLocal: '2027-12-06T09:00',
      arrivalLocal: '2027-12-06T10:15',
    };
    await createFlight('', body).expect(401);
    await createFlight(userCookie, body).expect(403);
    await createFlight(adminCookie, body).expect(403);
    expect(await flights.countDocuments({ flightNumber: 'V3S1' })).toBe(0);
    const res = await createFlight(mod.cookie, body).expect(201);
    expect(res.body).toMatchObject({ airlineId: mod.id, status: 'SCHEDULED' });

    // ACC-15: once the admin deactivates the airline, its real moderator session cannot add flights.
    const inactive = await airlineWithModerator('V3C');
    await airlines.updateOne({ _id: inactive.id }, { isActive: false });
    await createFlight(inactive.cookie, { ...body, flightNumber: 'V3S2' })
      .expect(403)
      .expect((r) => expect(r.body.code).toBe('FORBIDDEN'));
  });

  it('status, times in UTC, cabins and airlineId cannot be mass-assigned (400)', async () => {
    const res = await createFlight(mod.cookie, {
      flightNumber: 'V3M1',
      from: 'CDG',
      to: 'FRA',
      departureLocal: '2027-12-07T09:00',
      arrivalLocal: '2027-12-07T10:15',
      status: 'DEPARTED',
      departureUtc: '2027-12-07T08:00:00.000Z',
      cabins: [],
      airlineId: other.id,
    }).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(fieldsOf(res)).toEqual([
      'airlineId',
      'cabins',
      'departureUtc',
      'status',
    ]);
    expect(await flights.countDocuments({ flightNumber: 'V3M1' })).toBe(0);
  });

  // F-B-01: the "valid" Swagger examples of POST /api/flights depart on 2026-12-01 and stop working after it.
  it.failing(
    'the Swagger "valid" create examples stay valid after 1 Dec 2026',
    async () => {
      const service = app.get(FlightsService);
      const user = {
        id: new Types.ObjectId().toHexString(),
        role: Role.AirlineModerator,
        assignedProvider: { type: ProviderType.Airline, providerId: mod.id },
      };
      const dayAfter = new Date('2026-12-02T00:00:00Z');
      for (const example of [
        {
          flightNumber: 'MS777',
          from: 'CAI',
          to: 'DXB',
          departureLocal: '2026-12-01T14:30',
          arrivalLocal: '2026-12-01T18:45',
        },
        {
          flightNumber: 'BA117',
          from: 'LHR',
          to: 'JFK',
          departureLocal: '2026-12-01T08:25',
          arrivalLocal: '2026-12-01T11:20',
        },
      ]) {
        await expect(
          service.create(user, example, dayAfter),
        ).resolves.toBeDefined();
      }
    },
  );
});

describe('Cabins with real sessions (vv): FLT-04', () => {
  let mod: { id: string; cookie: string };
  let other: { id: string; cookie: string };
  let id: string;

  beforeAll(async () => {
    mod = await airlineWithModerator('V4A');
    other = await airlineWithModerator('V4B');
    id = await flightId(mod.cookie, {
      flightNumber: 'V4100',
      from: 'FRA',
      to: 'LHR',
      departureLocal: '2027-12-08T09:00',
      arrivalLocal: '2027-12-08T09:45',
    });
  });

  it("another airline's moderator, a user and a guest cannot add a cabin; nothing changes", async () => {
    await addCabin(other.cookie, id).expect(403);
    await addCabin(userCookie, id).expect(403);
    await addCabin(adminCookie, id).expect(403);
    await addCabin('', id).expect(401);
    expect((await flights.findById(id).lean())?.cabins).toEqual([]);
  });

  it('accepts each class of the fixed set once (any letter case) and the smallest valid values', async () => {
    const classes = ['economy', 'premium_economy', 'Business', 'FIRST'];
    for (const cls of classes) {
      await addCabin(mod.cookie, id, {
        class: cls,
        totalSeats: 1,
        priceMinor: 1,
        freeBags: 0,
        maxKgPerBag: 1,
      }).expect(201);
    }
    const stored = await flights.findById(id).lean();
    expect(stored?.cabins.map((c) => c.class)).toEqual([
      'ECONOMY',
      'PREMIUM_ECONOMY',
      'BUSINESS',
      'FIRST',
    ]);
    for (const cls of classes) {
      await addCabin(mod.cookie, id, { ...ECONOMY, class: cls }).expect(409);
    }
    const bad = await addCabin(mod.cookie, id, {
      ...ECONOMY,
      class: 'Premium Economy',
    }).expect(400);
    expect(fieldsOf(bad)).toEqual(['class']);
    expect((await flights.findById(id).lean())?.cabins).toHaveLength(4);
  });

  it('rejects seatsAvailable or ids in the body and numbers sent as text (400)', async () => {
    const id2 = await flightId(mod.cookie, {
      flightNumber: 'V4200',
      from: 'FRA',
      to: 'LHR',
      departureLocal: '2027-12-08T15:00',
      arrivalLocal: '2027-12-08T15:45',
    });
    const mass = await addCabin(mod.cookie, id2, {
      ...ECONOMY,
      seatsAvailable: 0,
      _id: new Types.ObjectId().toHexString(),
    }).expect(400);
    expect(fieldsOf(mass)).toEqual(['_id', 'seatsAvailable']);
    const text = await addCabin(mod.cookie, id2, {
      ...ECONOMY,
      totalSeats: '10',
      priceMinor: '20000',
      freeBags: '1',
    }).expect(400);
    expect(fieldsOf(text)).toEqual(['freeBags', 'priceMinor', 'totalSeats']);
    expect((await flights.findById(id2).lean())?.cabins).toEqual([]);
  });
});

describe('Edit flights with real sessions (vv): FLT-05', () => {
  let mod: { id: string; cookie: string };
  let other: { id: string; cookie: string };

  beforeAll(async () => {
    mod = await airlineWithModerator('V5A');
    other = await airlineWithModerator('V5B');
  });

  async function newFlight(
    flightNumber: string,
    over: Partial<FlightInput> = {},
  ): Promise<{ id: string; cabinId: string }> {
    const id = await flightId(mod.cookie, {
      flightNumber,
      from: 'CAI',
      to: 'DXB',
      departureLocal: '2027-12-01T14:30',
      arrivalLocal: '2027-12-01T18:45',
      ...over,
    });
    const res = await addCabin(mod.cookie, id).expect(201);
    return { id, cabinId: res.body.cabins[0].id as string };
  }

  const edit = (id: string, body: object, cookie = mod.cookie) =>
    http().patch(`/api/flights/${id}`).set('Cookie', cookie).send(body);
  const editCabin = (
    id: string,
    cabinId: string,
    body: object,
    cookie = mod.cookie,
  ) =>
    http()
      .patch(`/api/flights/${id}/cabins/${cabinId}`)
      .set('Cookie', cookie)
      .send(body);

  it("another airline's moderator, an admin, a user and a guest cannot edit; nothing changes", async () => {
    const { id, cabinId } = await newFlight('V5100');
    const before = await flights.findById(id).lean();
    for (const cookie of [other.cookie, adminCookie, userCookie]) {
      await edit(id, { departureLocal: '2027-12-01T15:30' }, cookie).expect(
        403,
      );
      await edit(id, { to: 'RUH' }, cookie).expect(403);
      await editCabin(
        id,
        cabinId,
        { priceMinor: 1, totalSeats: 1 },
        cookie,
      ).expect(403);
    }
    await edit(id, { departureLocal: '2027-12-01T15:30' }, '').expect(401);
    await editCabin(id, cabinId, { priceMinor: 1 }, '').expect(401);
    const after = await flights.findById(id).lean();
    expect(after?.departureUtc).toEqual(before?.departureUtc);
    expect(after?.to).toBe('DXB');
    expect(after?.cabins).toEqual(before?.cabins);
  });

  it('status, airline, seatsAvailable and class cannot be mass-assigned (400)', async () => {
    const { id, cabinId } = await newFlight('V5200');
    const before = await flights.findById(id).lean();
    for (const body of [
      { status: 'CANCELLED' },
      { airlineId: other.id },
      { cabins: [] },
      { departureUtc: '2027-12-01T00:00:00.000Z' },
    ]) {
      const res = await edit(id, body).expect(400);
      expect(fieldsOf(res)).toEqual(Object.keys(body));
    }
    for (const body of [
      { seatsAvailable: 500 },
      { class: 'FIRST' },
      { _id: new Types.ObjectId().toHexString() },
    ]) {
      const res = await editCabin(id, cabinId, body).expect(400);
      expect(fieldsOf(res)).toEqual(Object.keys(body));
    }
    const after = await flights.findById(id).lean();
    expect(after?.status).toBe(FlightStatus.Scheduled);
    expect(after?.cabins).toEqual(before?.cabins);
  });

  it('rejects an edited time that falls in a daylight-saving gap', async () => {
    const { id } = await newFlight('V5300', {
      from: 'LHR',
      to: 'FRA',
      departureLocal: '2027-03-27T10:00',
      arrivalLocal: '2027-03-27T12:30',
    });
    const res = await edit(id, {
      departureLocal: '2027-03-28T01:30',
      arrivalLocal: '2027-03-28T05:00',
    }).expect(400);
    expect(fieldsOf(res)).toEqual(['departureLocal']);
  });

  it('documents: changing an airport keeps the old local wall-clock time at the new airport (SQ-B-02)', async () => {
    const { id } = await newFlight('V5400');
    // Cairo 14:30 (12:30Z) becomes Riyadh 14:30 (11:30Z): the instant moves one hour earlier.
    const res = await edit(id, { from: 'RUH' }).expect(200);
    expect(res.body.departure).toMatchObject({
      airport: 'RUH',
      local: '2027-12-01T14:30:00.000+03:00',
      utc: '2027-12-01T11:30:00.000Z',
    });
    expect(res.body.durationMinutes).toBe(195);
  });

  it('documents: airports unlock again once the taken seats are released (SQ-B-03, approximation of "any booking")', async () => {
    const { id } = await newFlight('V5500');
    await flights.updateOne(
      { _id: id },
      { $inc: { 'cabins.0.seatsAvailable': -2 } },
    );
    await edit(id, { to: 'RUH' }).expect(409);
    // A cancelled or expired booking gives its seats back (ADR-0002)...
    await flights.updateOne(
      { _id: id },
      { $inc: { 'cabins.0.seatsAvailable': 2 } },
    );
    // ...and the flight no longer counts as having a booking.
    await edit(id, { to: 'RUH' }).expect(200);
  });
});

describe('Extra baggage policy (vv): FLT-08', () => {
  let mod: { id: string; cookie: string };
  let other: { id: string; cookie: string };
  const put = (airlineId: string, body: object, cookie = mod.cookie) =>
    http()
      .put(`/api/airlines/${airlineId}/baggage-policy`)
      .set('Cookie', cookie)
      .send(body);

  beforeAll(async () => {
    mod = await airlineWithModerator('V8A');
    other = await airlineWithModerator('V8B');
  });

  it('only the real moderator of this airline sets it; others get 401/403 and nothing changes', async () => {
    const body = { pricePerBagMinor: 4000, maxExtraBagsPerPassenger: 2 };
    await put(mod.id, body, other.cookie).expect(403);
    await put(mod.id, body, adminCookie).expect(403);
    await put(mod.id, body, userCookie).expect(403);
    await put(mod.id, body, '').expect(401);
    expect(
      (await airlines.findById(mod.id).lean())?.policy?.extraBaggage,
    ).toBeUndefined();
    const res = await put(mod.id, {
      pricePerBagMinor: 1,
      maxExtraBagsPerPassenger: 0,
    }).expect(200);
    expect(res.body.policy.extraBaggage).toEqual({
      pricePerBagMinor: 1,
      maxExtraBagsPerPassenger: 0,
    });
  });

  it('rejects a price not > 0, a negative cap, fractions, numbers as text and a separate weight (400)', async () => {
    for (const [body, fields] of [
      [
        { pricePerBagMinor: 0, maxExtraBagsPerPassenger: 1 },
        ['pricePerBagMinor'],
      ],
      [
        { pricePerBagMinor: '4000', maxExtraBagsPerPassenger: 1 },
        ['pricePerBagMinor'],
      ],
      [
        { pricePerBagMinor: 4000, maxExtraBagsPerPassenger: -1 },
        ['maxExtraBagsPerPassenger'],
      ],
      [
        { pricePerBagMinor: 4000, maxExtraBagsPerPassenger: 0.5 },
        ['maxExtraBagsPerPassenger'],
      ],
      [
        { pricePerBagMinor: 4000, maxExtraBagsPerPassenger: '2' },
        ['maxExtraBagsPerPassenger'],
      ],
      [
        {
          pricePerBagMinor: 4000,
          maxExtraBagsPerPassenger: 1,
          maxKgPerBag: 40,
        },
        ['maxKgPerBag'],
      ],
    ] as [object, string[]][]) {
      const res = await put(mod.id, body).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(fieldsOf(res)).toEqual(fields);
    }
    expect(
      (await airlines.findById(mod.id).lean())?.policy?.extraBaggage,
    ).toEqual({ pricePerBagMinor: 1, maxExtraBagsPerPassenger: 0 });
  });

  it("an extra bag's weight limit is the cabin's free-allowance limit: details show one kg value per cabin", async () => {
    await put(mod.id, {
      pricePerBagMinor: 5000,
      maxExtraBagsPerPassenger: 2,
    }).expect(200);
    const id = await flightId(mod.cookie, {
      flightNumber: 'V8100',
      from: 'HND',
      to: 'CAI',
      departureLocal: '2027-12-12T10:00',
      arrivalLocal: '2027-12-12T18:00',
    });
    await addCabin(mod.cookie, id, { ...ECONOMY, maxKgPerBag: 23 }).expect(201);
    await addCabin(mod.cookie, id, {
      ...ECONOMY,
      class: 'BUSINESS',
      maxKgPerBag: 32,
    }).expect(201);
    const res = await http().get(`/api/flights/${id}`).expect(200);
    expect(res.body.extraBaggage).toEqual({
      pricePerBagMinor: 5000,
      maxExtraBagsPerPassenger: 2,
    });
    expect(
      res.body.cabins.map((c: { class: string; maxKgPerBag: number }) => [
        c.class,
        c.maxKgPerBag,
      ]),
    ).toEqual([
      ['ECONOMY', 23],
      ['BUSINESS', 32],
    ]);
  });
});

describe('Cancellation tiers (vv): FLT-09', () => {
  let mod: { id: string; cookie: string };
  let other: { id: string; cookie: string };
  const put = (tiers: object[], cookie = mod.cookie, airlineId = mod.id) =>
    http()
      .put(`/api/airlines/${airlineId}/cancellation-policy`)
      .set('Cookie', cookie)
      .send({ tiers });
  const preview = async (days: number): Promise<number> =>
    (
      await http()
        .get(`/api/airlines/${mod.id}/cancellation-policy/refund-preview`)
        .query({ daysRemaining: days })
        .expect(200)
    ).body.refundPercent as number;

  beforeAll(async () => {
    mod = await airlineWithModerator('V9A');
    other = await airlineWithModerator('V9B');
  });

  it('applies the highest threshold not exceeding the days remaining (table)', async () => {
    await put([
      { daysBefore: 7, refundPercent: 50 },
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 1, refundPercent: 25 },
    ]).expect(200);
    const table: [number, number][] = [
      [365, 100],
      [31, 100],
      [30, 100], // exactly equal to a threshold
      [29, 50],
      [8, 50],
      [7, 50],
      [6, 25],
      [2, 25],
      [1, 25],
      [0, 0], // below every tier
    ];
    const got: [number, number][] = [];
    for (const [days] of table) got.push([days, await preview(days)]);
    expect(got).toEqual(table);
  });

  it('a 0-day tier applies on the day itself; decimals are kept; an empty list refunds 0%', async () => {
    await put([
      { daysBefore: 3, refundPercent: 60.5 },
      { daysBefore: 0, refundPercent: 10 },
    ]).expect(200);
    const got: number[] = [];
    for (const days of [0, 2, 3, 100]) got.push(await preview(days));
    expect(got).toEqual([10, 10, 60.5, 60.5]);

    await put([]).expect(200);
    const none: number[] = [];
    for (const days of [0, 7, 365]) none.push(await preview(days));
    expect(none).toEqual([0, 0, 0]);
  });

  it('accepts 0% and 100%; rejects percentages outside 0-100, more than two decimals and days as text', async () => {
    await put([
      { daysBefore: 0, refundPercent: 0 },
      { daysBefore: 10, refundPercent: 100 },
    ]).expect(200);
    for (const tier of [
      { daysBefore: 5, refundPercent: 100.01 },
      { daysBefore: 5, refundPercent: -0.01 },
      { daysBefore: 5, refundPercent: 50.125 },
      { daysBefore: '5', refundPercent: 50 },
      { daysBefore: 5, refundPercent: 50, label: 'x' },
    ]) {
      const res = await put([tier]).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.fieldErrors.length).toBeGreaterThan(0);
    }
    expect(
      (await airlines.findById(mod.id).lean())?.policy.cancellationTiers,
    ).toEqual([
      { daysBefore: 0, refundPercent: 0 },
      { daysBefore: 10, refundPercent: 100 },
    ]);
  });

  it('only the real moderator of this airline sets tiers; others get 401/403 and nothing changes', async () => {
    const tiers = [{ daysBefore: 1, refundPercent: 99 }];
    await put(tiers, other.cookie).expect(403);
    await put(tiers, adminCookie).expect(403);
    await put(tiers, userCookie).expect(403);
    await put(tiers, '').expect(401);
    expect(
      (await airlines.findById(mod.id).lean())?.policy.cancellationTiers,
    ).toEqual([
      { daysBefore: 0, refundPercent: 0 },
      { daysBefore: 10, refundPercent: 100 },
    ]);
  });
});

describe('Flight search (vv): FLT-11', () => {
  let mod: { id: string; cookie: string };

  beforeAll(async () => {
    mod = await airlineWithModerator('VSA');
  });

  async function withCabin(body: FlightInput, cabin: object = ECONOMY) {
    const id = await flightId(mod.cookie, body);
    await addCabin(mod.cookie, id, cabin).expect(201);
    return id;
  }

  it('guests (no cookie) and logged-in users search alike; a late-evening New York flight belongs to its local date', async () => {
    // 23:30 New York on 1 Dec is 04:30Z on 2 Dec; 00:30 on 2 Dec is 05:30Z on 2 Dec.
    await withCabin({
      flightNumber: 'VS100',
      from: 'JFK',
      to: 'LHR',
      departureLocal: '2027-12-01T23:30',
      arrivalLocal: '2027-12-02T11:30',
    });
    await withCabin({
      flightNumber: 'VS110',
      from: 'JFK',
      to: 'LHR',
      departureLocal: '2027-12-02T00:30',
      arrivalLocal: '2027-12-02T12:30',
    });
    const q = (departureDate: string) => ({
      from: 'JFK',
      to: 'LHR',
      departureDate,
      passengers: 1,
    });
    const guest = await search(q('2027-12-01')).expect(200);
    expect(numbersOf(guest)).toEqual(['VS100']);
    expect(guest.body.items[0].departure.local).toBe(
      '2027-12-01T23:30:00.000-05:00',
    );
    const user = await http()
      .get('/api/flights/search')
      .set('Cookie', userCookie)
      .query(q('2027-12-01'))
      .expect(200);
    expect(user.body).toEqual(guest.body);
    expect(numbersOf(await search(q('2027-12-02')).expect(200))).toEqual([
      'VS110',
    ]);
  });

  it('a local day that is 23 or 25 hours long (DST change) still holds its first and last flights', async () => {
    const lhr = (flightNumber: string, dep: string, arr: string) =>
      withCabin({
        flightNumber,
        from: 'LHR',
        to: 'CDG',
        departureLocal: dep,
        arrivalLocal: arr,
      });
    await lhr('VS200', '2027-10-31T00:30', '2027-10-31T05:00'); // BST, 30 Oct 23:30Z
    await lhr('VS210', '2027-10-31T23:30', '2027-11-01T02:00'); // GMT, 31 Oct 23:30Z
    await lhr('VS220', '2027-03-28T00:30', '2027-03-28T05:00'); // GMT, 28 Mar 00:30Z
    await lhr('VS230', '2027-03-28T23:30', '2027-03-29T02:00'); // BST, 28 Mar 22:30Z
    const on = async (departureDate: string) =>
      numbersOf(
        await search({
          from: 'LHR',
          to: 'CDG',
          departureDate,
          passengers: 1,
        }).expect(200),
      );
    expect(await on('2027-10-31')).toEqual(['VS200', 'VS210']);
    expect(await on('2027-10-30')).toEqual([]);
    expect(await on('2027-11-01')).toEqual([]);
    expect(await on('2027-03-28')).toEqual(['VS220', 'VS230']);
    expect(await on('2027-03-27')).toEqual([]);
    expect(await on('2027-03-29')).toEqual([]);
  });

  it('lists a cabin only while its available seats (total - taken) cover every passenger', async () => {
    const id = await withCabin(
      {
        flightNumber: 'VS300',
        from: 'RUH',
        to: 'CAI',
        departureLocal: '2027-12-04T09:00',
        arrivalLocal: '2027-12-04T11:00',
      },
      { ...ECONOMY, totalSeats: 5 },
    );
    const count = async (passengers: number) =>
      (
        await search({
          from: 'RUH',
          to: 'CAI',
          departureDate: '2027-12-04',
          passengers,
        }).expect(200)
      ).body.total as number;
    expect([await count(5), await count(6)]).toEqual([1, 0]);
    // Two seats booked or held (FLT-22 not built: taken straight off seatsAvailable, ADR-0002).
    await flights.updateOne(
      { _id: id },
      { $inc: { 'cabins.0.seatsAvailable': -2 } },
    );
    expect([await count(3), await count(4)]).toEqual([1, 0]);
    const res = await search({
      from: 'RUH',
      to: 'CAI',
      departureDate: '2027-12-04',
      passengers: 3,
    }).expect(200);
    expect(res.body.items[0]).toMatchObject({
      seatsLeft: 3,
      totalPriceMinor: 60000,
    });
  });

  it('hides a Scheduled flight that left earlier today (before the status job runs), keeps one later today', async () => {
    const dubai = DateTime.now().setZone('Asia/Dubai');
    const leftId = await withCabin({
      flightNumber: 'VS400',
      from: 'DXB',
      to: 'RUH',
      departureLocal: dubai.plus({ hours: 3 }).toFormat(LOCAL),
      arrivalLocal: dubai.plus({ hours: 5 }).toFormat(LOCAL),
    });
    const leftAt = new Date(Date.now() - 60_000);
    await flights.updateOne(
      { _id: leftId },
      {
        $set: {
          departureUtc: leftAt,
          arrivalUtc: new Date(Date.now() + 3_600_000),
        },
      },
    );
    const soon = dubai.plus({ minutes: 30 });
    await withCabin({
      flightNumber: 'VS410',
      from: 'DXB',
      to: 'RUH',
      departureLocal: soon.toFormat(LOCAL),
      arrivalLocal: soon.plus({ hours: 2 }).toFormat(LOCAL),
    });
    const on = async (date: string) =>
      numbersOf(
        await search({
          from: 'DXB',
          to: 'RUH',
          departureDate: date,
          passengers: 1,
        }).expect(200),
      );
    const leftDate = DateTime.fromJSDate(leftAt, {
      zone: 'Asia/Dubai',
    }).toISODate()!;
    expect(await on(leftDate)).not.toContain('VS400');
    expect(await on(soon.toISODate()!)).toContain('VS410');
  });
});

describe('Price range, sort and pages (vv): FLT-15', () => {
  const query = (q: Record<string, string | number>) =>
    search({
      from: 'CDG',
      to: 'FRA',
      departureDate: '2027-12-06',
      passengers: 3,
      ...q,
    });

  beforeAll(async () => {
    const mod = await airlineWithModerator('VPA');
    // 11 options that tie on price, departure and duration, plus one with too few seats for 3.
    for (let i = 1; i <= 12; i++) {
      const id = await flightId(mod.cookie, {
        flightNumber: `VP${String(i).padStart(2, '0')}`,
        from: 'CDG',
        to: 'FRA',
        departureLocal: '2027-12-06T09:00',
        arrivalLocal: '2027-12-06T10:15',
      });
      await addCabin(mod.cookie, id, {
        ...ECONOMY,
        totalSeats: i === 12 ? 2 : 10,
      }).expect(201);
    }
  });

  it.each(['price', 'duration', 'departure'])(
    'sort=%s: 11 tied options give 2 pages of 10 and 1, with no repeats or gaps (GEN-05)',
    async (sort) => {
      const p1 = await query({ sort, page: 1 }).expect(200);
      const p2 = await query({ sort, page: 2 }).expect(200);
      expect(p1.body).toMatchObject({
        page: 1,
        limit: 10,
        total: 11,
        totalPages: 2,
      });
      expect(p1.body.items).toHaveLength(10);
      expect(p2.body.items).toHaveLength(1);
      const all = [...numbersOf(p1), ...numbersOf(p2)];
      expect(new Set(all).size).toBe(11);
      expect(all).not.toContain('VP12');
      // The same request twice gives the same order.
      const again = await query({ sort, page: 1 }).expect(200);
      expect(numbersOf(again)).toEqual(numbersOf(p1));
    },
  );

  it('the inclusive range keeps fares equal to either bound and keeps the passenger criterion', async () => {
    const total = async (q: Record<string, string | number>) =>
      (await query(q).expect(200)).body.total as number;
    expect(await total({ minPriceMinor: 20000, maxPriceMinor: 20000 })).toBe(
      11,
    );
    expect(
      await total({
        minPriceMinor: 20000,
        maxPriceMinor: 20000,
        passengers: 1,
      }),
    ).toBe(12);
    expect(await total({ minPriceMinor: 20001 })).toBe(0);
    expect(await total({ maxPriceMinor: 19999 })).toBe(0);
    const err = (
      await query({ minPriceMinor: 20001, maxPriceMinor: 20000 }).expect(400)
    ).body;
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fieldErrors.map((f: { field: string }) => f.field)).toEqual([
      'maxPriceMinor',
    ]);
  });
});

describe('Departed lifecycle with real sessions (vv): FLT-30', () => {
  let mod: { id: string; cookie: string };

  beforeAll(async () => {
    mod = await airlineWithModerator('VTA');
  });

  it('becomes Departed exactly when its departure time is reached, then is no longer searchable or editable', async () => {
    const riyadh = DateTime.now().setZone('Asia/Riyadh').plus({ days: 3 });
    const id = await flightId(mod.cookie, {
      flightNumber: 'VT100',
      from: 'RUH',
      to: 'HND',
      departureLocal: riyadh.toFormat(LOCAL),
      arrivalLocal: riyadh.plus({ hours: 16 }).toFormat(LOCAL),
    });
    const cabin = await addCabin(mod.cookie, id).expect(201);
    const cabinId = cabin.body.cabins[0].id as string;
    const departure = (await flights.findById(id).lean())!.departureUtc;
    const date = riyadh.toISODate()!;
    const listed = async () =>
      numbersOf(
        await search({
          from: 'RUH',
          to: 'HND',
          departureDate: date,
          passengers: 1,
        }).expect(200),
      );
    expect(await listed()).toEqual(['VT100']);

    const status = app.get(FlightStatusService);
    await status.markDeparted(new Date(departure.getTime() - 1));
    expect((await flights.findById(id).lean())?.status).toBe('SCHEDULED');
    await status.markDeparted(departure);
    expect((await flights.findById(id).lean())?.status).toBe('DEPARTED');

    expect(await listed()).toEqual([]);
    const before = await flights.findById(id).lean();
    await http()
      .patch(`/api/flights/${id}`)
      .set('Cookie', mod.cookie)
      .send({ arrivalLocal: riyadh.plus({ hours: 17 }).toFormat(LOCAL) })
      .expect(409);
    await http()
      .patch(`/api/flights/${id}/cabins/${cabinId}`)
      .set('Cookie', mod.cookie)
      .send({ priceMinor: 1 })
      .expect(409);
    await addCabin(mod.cookie, id, { ...ECONOMY, class: 'FIRST' }).expect(409);
    const after = await flights.findById(id).lean();
    expect(after?.cabins).toEqual(before?.cabins);
    expect(after?.arrivalUtc).toEqual(before?.arrivalUtc);
    const details = await http().get(`/api/flights/${id}`).expect(200);
    expect(details.body).toMatchObject({ status: 'DEPARTED', bookable: false });
  });

  it('a Cancelled flight is not searchable or editable either', async () => {
    const id = await flightId(mod.cookie, {
      flightNumber: 'VT200',
      from: 'RUH',
      to: 'HND',
      departureLocal: '2027-12-14T09:00',
      arrivalLocal: '2027-12-15T01:00',
    });
    const cabin = await addCabin(mod.cookie, id).expect(201);
    await flights.updateOne(
      { _id: id },
      { $set: { status: FlightStatus.Cancelled } },
    );
    expect(
      numbersOf(
        await search({
          from: 'RUH',
          to: 'HND',
          departureDate: '2027-12-14',
          passengers: 1,
        }).expect(200),
      ),
    ).toEqual([]);
    await http()
      .patch(`/api/flights/${id}`)
      .set('Cookie', mod.cookie)
      .send({ departureLocal: '2027-12-14T10:00' })
      .expect(409);
    await http()
      .patch(`/api/flights/${id}/cabins/${cabin.body.cabins[0].id}`)
      .set('Cookie', mod.cookie)
      .send({ totalSeats: 20 })
      .expect(409);
    expect((await flights.findById(id).lean())?.cabins[0].totalSeats).toBe(10);
  });
});

describe('Local times in every flight response (vv): GEN-06', () => {
  let mod: { id: string; cookie: string };

  beforeAll(async () => {
    mod = await airlineWithModerator('VGA');
  });

  const expectZones = (
    body: { departure: object; arrival: object },
    dep: string,
    arr: string,
  ) => {
    expect(body.departure).toMatchObject({
      airport: 'HND',
      timeZone: 'Asia/Tokyo',
      local: dep,
    });
    expect(body.arrival).toMatchObject({
      airport: 'JFK',
      timeZone: 'America/New_York',
      local: arr,
    });
  };

  it('create, add cabin, edit cabin, edit flight, details and search all show each airport’s local time', async () => {
    // Tokyo 18:00 (09:00Z) to New York 17:00 (22:00Z) on 8 Dec.
    const created = await createFlight(mod.cookie, {
      flightNumber: 'VG100',
      from: 'HND',
      to: 'JFK',
      departureLocal: '2027-12-08T18:00',
      arrivalLocal: '2027-12-08T17:00',
    }).expect(201);
    const id = created.body.id as string;
    const dep = '2027-12-08T18:00:00.000+09:00';
    expectZones(created.body, dep, '2027-12-08T17:00:00.000-05:00');
    expect(created.body.durationMinutes).toBe(780);

    const cabin = await addCabin(mod.cookie, id).expect(201);
    expectZones(cabin.body, dep, '2027-12-08T17:00:00.000-05:00');
    const edited = await http()
      .patch(`/api/flights/${id}/cabins/${cabin.body.cabins[0].id}`)
      .set('Cookie', mod.cookie)
      .send({ priceMinor: 21000 })
      .expect(200);
    expectZones(edited.body, dep, '2027-12-08T17:00:00.000-05:00');

    const moved = await http()
      .patch(`/api/flights/${id}`)
      .set('Cookie', mod.cookie)
      .send({ arrivalLocal: '2027-12-08T17:30' })
      .expect(200);
    const arr = '2027-12-08T17:30:00.000-05:00';
    expectZones(moved.body, dep, arr);
    expect(moved.body.arrival.utc).toBe('2027-12-08T22:30:00.000Z');

    const details = await http().get(`/api/flights/${id}`).expect(200);
    expectZones(details.body, dep, arr);
    const found = await search({
      from: 'HND',
      to: 'JFK',
      departureDate: '2027-12-08',
      passengers: 1,
    }).expect(200);
    expectZones(found.body.items[0], dep, arr);
  });

  it('uses the summer offset in July (New York UTC-4, London UTC+1)', async () => {
    const created = await createFlight(mod.cookie, {
      flightNumber: 'VG200',
      from: 'LHR',
      to: 'JFK',
      departureLocal: '2027-07-15T10:00',
      arrivalLocal: '2027-07-15T13:00',
    }).expect(201);
    const details = await http()
      .get(`/api/flights/${created.body.id}`)
      .expect(200);
    expect(details.body).toMatchObject({
      departure: {
        local: '2027-07-15T10:00:00.000+01:00',
        utc: '2027-07-15T09:00:00.000Z',
      },
      arrival: {
        local: '2027-07-15T13:00:00.000-04:00',
        utc: '2027-07-15T17:00:00.000Z',
      },
      durationMinutes: 480,
      // FLT-17: an airline with no policies shows no extra baggage and no refund tiers (0%).
      extraBaggage: null,
      cancellationTiers: [],
    });
  });
});

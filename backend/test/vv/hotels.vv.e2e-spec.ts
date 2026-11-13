import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../../src/common/auth/auth.types';
import { Hotel, Room } from '../../src/modules/hotels';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../../src/modules/reference';
import { loginAs } from '../support/auth';
import { createTestApp } from '../support/create-test-app';

const DATA_DIR = join(__dirname, '..', '..', 'seed', 'data');
const TEMP = 'Temp2026x';
const OWN = 'MyOwn2027';

/**
 * V&V track C (hotels), merged scope: HTL-01, HTL-03, HTL-04. Every request uses a real cookie
 * session: an admin creates hotels P and Q and one hotel moderator for each through
 * POST /api/admin/moderators; each moderator changes the temporary password before acting.
 */
let app: INestApplication<App>;
let hotels: Model<Hotel>;
let rooms: Model<Room>;
let adminCookie: string;
let travellerCookie: string;
let airlineModCookie: string;
let hotelP: string;
let hotelQ: string;
let modP: string;
let modQ: string;

const http = () => request(app.getHttpServer());
/** The distinct field names in a 400 response (one field may carry several messages). */
const fields = (res: request.Response): string[] => [
  ...new Set(
    ((res.body.fieldErrors ?? []) as { field: string }[]).map((f) => f.field),
  ),
];
const cookieOf = (res: request.Response) =>
  (res.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('access_token='))!
    .split(';')[0];
const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

const createHotel = async (name: string, cityId = 'cairo') =>
  (
    await http()
      .post('/api/hotels')
      .set('Cookie', adminCookie)
      .send({ name, address: '1 Test Street', cityId })
      .expect(201)
  ).body.id as string;

/** Creates a hotel moderator via ACC-13 and logs in; `changePassword: false` keeps the temp password. */
const hotelModerator = async (hotelId: string, changePassword = true) => {
  const email = `vv.hmod.${new Types.ObjectId().toHexString()}@example.com`;
  await http()
    .post('/api/admin/moderators')
    .set('Cookie', adminCookie)
    .send({
      name: 'VV Hotel Moderator',
      email,
      role: 'HOTEL_MODERATOR',
      providerId: hotelId,
      temporaryPassword: TEMP,
    })
    .expect(201);
  const login = await http()
    .post('/api/auth/login')
    .send({ email, password: TEMP })
    .expect(200);
  const cookie = cookieOf(login);
  if (changePassword) {
    await http()
      .patch('/api/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: TEMP, newPassword: OWN })
      .expect(204);
  }
  return cookie;
};

const room = (over: Record<string, unknown> = {}) => ({
  number: '101',
  type: 'Double',
  beds: 2,
  maxOccupancy: 3,
  priceMinor: 10000,
  ...over,
});
const addRoom = (hotelId: string, cookie: string, body: object) =>
  http().post(`/api/hotels/${hotelId}/rooms`).set('Cookie', cookie).send(body);
const addRanges = (
  hotelId: string,
  roomId: string,
  cookie: string,
  body: object,
) =>
  http()
    .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
    .set('Cookie', cookie)
    .send(body);
const r = (from: string, to: string) => ({ from, to });

beforeAll(async () => {
  app = await createTestApp();
  await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
  hotels = app.get(getModelToken(Hotel.name));
  rooms = app.get(getModelToken(Room.name));
  adminCookie = (await loginAs(app, Role.Admin)).cookie;
  travellerCookie = (await loginAs(app, Role.User)).cookie;
  airlineModCookie = (await loginAs(app, Role.AirlineModerator)).cookie;
  hotelP = await createHotel('VV Hotel P');
  hotelQ = await createHotel('VV Hotel Q');
  modP = await hotelModerator(hotelP);
  modQ = await hotelModerator(hotelQ);
});

afterAll(async () => {
  await app.close();
});

describe('Hotel profile create and edit (vv): HTL-01', () => {
  it('only an admin creates a hotel (real cookies): 401 signed out, 403 for traveller and moderators', async () => {
    const body = {
      name: 'Gate Hotel',
      address: '9 Gate Road',
      cityId: 'cairo',
    };
    const before = await hotels.countDocuments();
    await http().post('/api/hotels').send(body).expect(401);
    for (const cookie of [travellerCookie, modP, airlineModCookie]) {
      await http()
        .post('/api/hotels')
        .set('Cookie', cookie)
        .send(body)
        .expect(403);
    }
    expect(await hotels.countDocuments()).toBe(before);
  });

  it('the admin sets every workbook field; the country is derived from the city', async () => {
    const photos = [1, 2, 3, 4, 5].map(
      (n) => `https://cdn.example.com/${n}.jpg`,
    );
    const res = await http()
      .post('/api/hotels')
      .set('Cookie', adminCookie)
      .send({
        name: 'Full Profile Hotel',
        address: '12 Corniche El Nil',
        cityId: 'cairo',
        description: 'All fields',
        photos,
        starClass: 5,
        amenities: ['WiFi', 'Pool'],
      })
      .expect(201);
    expect(res.body).toMatchObject({
      cityId: 'cairo',
      countryCode: 'EG',
      photos,
      starClass: 5,
      amenities: ['WiFi', 'Pool'],
      description: 'All fields',
    });
  });

  it('a countryCode in the body is an unknown field (create and edit), so the country cannot contradict the city', async () => {
    const create = await http()
      .post('/api/hotels')
      .set('Cookie', adminCookie)
      .send({
        name: 'Mismatch Hotel',
        address: '1 Mismatch Road',
        cityId: 'cairo',
        countryCode: 'GB',
      })
      .expect(400);
    expect(create.body.code).toBe('VALIDATION_FAILED');
    expect(fields(create)).toContain('countryCode');

    const edit = await http()
      .patch(`/api/hotels/${hotelP}`)
      .set('Cookie', modP)
      .send({ cityId: 'london', countryCode: 'EG' })
      .expect(400);
    expect(fields(edit)).toContain('countryCode');
    expect((await hotels.findById(hotelP).lean())?.countryCode).toBe('EG');
  });

  it('edit rejects mass-assigned isActive, ratingAvg and hotelId with field errors', async () => {
    const res = await http()
      .patch(`/api/hotels/${hotelP}`)
      .set('Cookie', modP)
      .send({
        name: 'Mass Assign',
        isActive: false,
        ratingAvg: 5,
        hotelId: hotelQ,
      })
      .expect(400);
    expect(fields(res)).toEqual(
      expect.arrayContaining(['isActive', 'ratingAvg', 'hotelId']),
    );
    const stored = await hotels.findById(hotelP).lean();
    expect(stored?.isActive).toBe(true);
    expect(stored?.name).toBe('VV Hotel P');
  });

  it('a moderator still on the temporary password cannot edit (PASSWORD_CHANGE_REQUIRED)', async () => {
    const cookie = await hotelModerator(hotelP, false);
    const res = await http()
      .patch(`/api/hotels/${hotelP}`)
      .set('Cookie', cookie)
      .send({ name: 'Too Early' })
      .expect(403);
    expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('the moderator of P edits every field of P (photos up to 5, star class, amenities, city moves the country)', async () => {
    const photos = [1, 2, 3, 4, 5].map(
      (n) => `https://cdn.example.com/p${n}.jpg`,
    );
    const res = await http()
      .patch(`/api/hotels/${hotelP}`)
      .set('Cookie', modP)
      .send({
        name: 'VV Hotel P Grand',
        address: '2 New Address Street',
        cityId: 'london',
        description: 'Edited',
        photos,
        starClass: 3,
        amenities: ['Gym'],
      })
      .expect(200);
    expect(res.body).toMatchObject({
      name: 'VV Hotel P Grand',
      address: '2 New Address Street',
      cityId: 'london',
      countryCode: 'GB',
      description: 'Edited',
      photos,
      starClass: 3,
      amenities: ['Gym'],
    });
  });

  it('star class must be a whole number 1-5 and photos at most 5 (real cookie)', async () => {
    for (const starClass of [0, 6, 3.5, '4']) {
      const res = await http()
        .patch(`/api/hotels/${hotelP}`)
        .set('Cookie', modP)
        .send({ starClass })
        .expect(400);
      expect(fields(res)).toEqual(['starClass']);
    }
    const six = await http()
      .patch(`/api/hotels/${hotelP}`)
      .set('Cookie', modP)
      .send({ photos: Array(6).fill('https://cdn.example.com/x.jpg') })
      .expect(400);
    expect(fields(six)).toContain('photos');
    expect((await hotels.findById(hotelP).lean())?.starClass).toBe(3);
  });

  it('the moderator of Q, an airline moderator and the admin cannot edit P; P is unchanged', async () => {
    const before = await hotels.findById(hotelP).lean();
    await http()
      .patch(`/api/hotels/${hotelP}`)
      .set('Cookie', modQ)
      .send({ name: 'Hijacked by Q' })
      .expect(403);
    await http()
      .patch(`/api/hotels/${hotelP}`)
      .set('Cookie', airlineModCookie)
      .send({ name: 'Hijacked by airline' })
      .expect(403);
    await http()
      .patch(`/api/hotels/${hotelP}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Hijacked by admin' })
      .expect(403);
    await http()
      .patch(`/api/hotels/${hotelP}`)
      .send({ name: 'Anonymous' })
      .expect(401);
    const after = await hotels.findById(hotelP).lean();
    expect(after?.name).toBe(before?.name);
    expect(after?.updatedAt).toEqual(before?.updatedAt);
  });

  // F-C-01 (fixed): an unknown city is a cityId field error, like unknown airports in flights.
  it('an unknown city returns 400 VALIDATION_FAILED with a field error on cityId (GEN-02)', async () => {
    const res = await http()
      .post('/api/hotels')
      .set('Cookie', adminCookie)
      .send({
        name: 'Nowhere Inn',
        address: '1 Nowhere Road',
        cityId: 'atlantis',
      })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(fields(res)).toEqual(['cityId']);
  });

  it('HTL-02 is not started: GET /api/hotels/:id does not exist yet (discoverability gap, not a defect)', async () => {
    const res = await http()
      .get(`/api/hotels/${hotelP}`)
      .set('Cookie', travellerCookie);
    expect(res.status).toBe(404);
  });
});

describe('Add a room (vv): HTL-03', () => {
  it('room number is unique within a hotel, ignoring case and surrounding spaces; the same number is fine in another hotel', async () => {
    await addRoom(hotelP, modP, room({ number: 'R-201' })).expect(201);
    await addRoom(hotelP, modP, room({ number: '  r-201 ' })).expect(409);
    await addRoom(hotelQ, modQ, room({ number: 'R-201' })).expect(201);
    expect(
      await rooms.countDocuments({ hotelId: hotelP, number: /^r-201$/i }),
    ).toBe(1);
  });

  it('the moderator of Q and an airline moderator cannot add rooms to P; nothing is created', async () => {
    await addRoom(hotelP, modQ, room({ number: 'Q-INTO-P' })).expect(403);
    await addRoom(
      hotelP,
      airlineModCookie,
      room({ number: 'A-INTO-P' }),
    ).expect(403);
    await http()
      .post(`/api/hotels/${hotelP}/rooms`)
      .send(room({ number: 'ANON' }))
      .expect(401);
    expect(
      await rooms.countDocuments({
        number: { $in: ['Q-INTO-P', 'A-INTO-P', 'ANON'] },
      }),
    ).toBe(0);
  });

  it('beds, occupancy and price must be whole numbers; occupancy >= 1 and price > 0; no string coercion', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ maxOccupancy: 0 }, 'maxOccupancy'],
      [{ maxOccupancy: 1.5 }, 'maxOccupancy'],
      [{ priceMinor: 0 }, 'priceMinor'],
      [{ priceMinor: 99.5 }, 'priceMinor'],
      [{ priceMinor: '10000' }, 'priceMinor'],
      [{ beds: 2.5 }, 'beds'],
      [{ beds: '2' }, 'beds'],
    ];
    for (const [over, field] of cases) {
      const res = await addRoom(
        hotelP,
        modP,
        room({ number: 'BAD', ...over }),
      ).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(fields(res)).toEqual([field]);
    }
    await addRoom(
      hotelP,
      modP,
      room({ number: 'MIN', beds: 1, maxOccupancy: 1, priceMinor: 1 }),
    ).expect(201);
  });

  it('rejects mass-assigned hotelId, isActive, availability and everReserved', async () => {
    const res = await addRoom(
      hotelP,
      modP,
      room({
        number: 'MASS',
        hotelId: hotelQ,
        isActive: false,
        everReserved: true,
        availability: [r('2030-01-01', '2030-02-01')],
      }),
    ).expect(400);
    expect(fields(res)).toEqual(
      expect.arrayContaining([
        'hotelId',
        'isActive',
        'availability',
        'everReserved',
      ]),
    );
    expect(await rooms.countDocuments({ number: 'MASS' })).toBe(0);
  });
});

describe('Bookable date ranges (vv): HTL-04', () => {
  let roomP: string;
  let roomQ: string;

  beforeAll(async () => {
    roomP = (await addRoom(hotelP, modP, room({ number: 'AV-P' })).expect(201))
      .body.id as string;
    roomQ = (await addRoom(hotelQ, modQ, room({ number: 'AV-Q' })).expect(201))
      .body.id as string;
    await addRanges(hotelP, roomP, modP, {
      ranges: [r('2030-01-10', '2030-01-20')],
    }).expect(201);
  });

  const storedRanges = async (id: string) =>
    ((await rooms.findById(id).lean())?.availability ?? []).map((x) => ({
      from: x.from,
      to: x.to,
    }));

  it('an identical range is refused with 409 and nothing is added', async () => {
    await addRanges(hotelP, roomP, modP, {
      ranges: [r('2030-01-10', '2030-01-20')],
    }).expect(409);
    expect(await storedRanges(roomP)).toEqual([r('2030-01-10', '2030-01-20')]);
  });

  it('a range overlapping by one night is 409; touching ranges [from,to) on both sides are accepted', async () => {
    await addRanges(hotelP, roomP, modP, {
      ranges: [r('2030-01-19', '2030-01-25')],
    }).expect(409);
    await addRanges(hotelP, roomP, modP, {
      ranges: [r('2030-01-05', '2030-01-10'), r('2030-01-20', '2030-01-25')],
    }).expect(201);
    expect(await storedRanges(roomP)).toEqual([
      r('2030-01-05', '2030-01-10'),
      r('2030-01-10', '2030-01-20'),
      r('2030-01-20', '2030-01-25'),
    ]);
  });

  it('two identical or overlapping ranges inside one request are 400 and nothing is added', async () => {
    await addRanges(hotelP, roomP, modP, {
      ranges: [r('2031-01-01', '2031-01-05'), r('2031-01-01', '2031-01-05')],
    }).expect(400);
    await addRanges(hotelP, roomP, modP, {
      ranges: [r('2031-02-01', '2031-02-10'), r('2031-02-09', '2031-02-12')],
    }).expect(400);
    expect(await storedRanges(roomP)).toHaveLength(3);
  });

  // F-C-02 (fixed): an overlap inside one request names the later range in fieldErrors.
  it('an overlap inside one request names the failing range in fieldErrors (GEN-02)', async () => {
    const res = await addRanges(hotelP, roomP, modP, {
      ranges: [r('2031-03-01', '2031-03-10'), r('2031-03-05', '2031-03-12')],
    }).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(fields(res)).toContain('ranges[1].from');
  });

  it('derived: a range that has already ended is 400; at most 366 nights; extra keys in a range are rejected', async () => {
    const past = await addRanges(hotelP, roomP, modP, {
      ranges: [r(isoDay(-10), isoDay(0))],
    }).expect(400);
    expect(fields(past)).toContain('ranges[0].to');
    const long = await addRanges(hotelP, roomP, modP, {
      ranges: [r('2032-01-01', '2033-01-02')],
    }).expect(400);
    expect(fields(long)).toContain('ranges[0].to');
    const open = await addRanges(hotelP, roomP, modP, {
      ranges: [{ from: '2032-01-01' }],
    }).expect(400);
    expect(fields(open)).toContain('ranges[0].to');
    const extra = await addRanges(hotelP, roomP, modP, {
      ranges: [{ ...r('2032-05-01', '2032-05-05'), kind: 'BOOKED' }],
    }).expect(400);
    expect(fields(extra).join(',')).toMatch(/kind/);
    expect(await storedRanges(roomP)).toHaveLength(3);
  });

  it('derived (spec question): a range that started in the past but ends in the future is accepted as sent', async () => {
    const res = await addRanges(hotelQ, roomQ, modQ, {
      ranges: [r(isoDay(-3), isoDay(4))],
    }).expect(201);
    expect(res.body.availability).toEqual([r(isoDay(-3), isoDay(4))]);
  });

  it("another hotel's moderator cannot add ranges to P's room (403 via P, 404 via Q); P's room is unchanged", async () => {
    await addRanges(hotelP, roomP, modQ, {
      ranges: [r('2034-01-01', '2034-01-05')],
    }).expect(403);
    await addRanges(hotelQ, roomP, modQ, {
      ranges: [r('2034-01-01', '2034-01-05')],
    }).expect(404);
    await addRanges(hotelP, roomP, airlineModCookie, {
      ranges: [r('2034-01-01', '2034-01-05')],
    }).expect(403);
    expect(await storedRanges(roomP)).toHaveLength(3);
  });

  it('a room id that is not in the hotel, or unknown, is 404', async () => {
    await addRanges(hotelP, roomQ, modP, {
      ranges: [r('2034-02-01', '2034-02-05')],
    }).expect(404);
    await addRanges(hotelP, new Types.ObjectId().toHexString(), modP, {
      ranges: [r('2034-02-01', '2034-02-05')],
    }).expect(404);
    expect(await storedRanges(roomQ)).toHaveLength(1);
  });
});

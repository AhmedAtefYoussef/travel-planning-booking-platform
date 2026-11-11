import mongoose, { Types } from 'mongoose';
import { HotelSchema } from './hotel.schema';
import { ReviewSchema } from './review.schema';
import { RoomNightSchema, RoomNightState } from './room-night.schema';
import { RoomSchema } from './room.schema';

// Models on a connection that is never opened: validateSync() runs the schema rules without a database.
const conn = mongoose.createConnection();
const HotelModel = conn.model('HotelSpec', HotelSchema);
const RoomModel = conn.model('RoomSpec', RoomSchema);
const RoomNightModel = conn.model('RoomNightSpec', RoomNightSchema);
const ReviewModel = conn.model('ReviewSpec', ReviewSchema);

// validate() (not validateSync) so the pre('validate') consistency hooks run too.
async function errorPaths(doc: mongoose.Document): Promise<string[]> {
  try {
    await doc.validate();
    return [];
  } catch (e) {
    return Object.keys(
      (e as mongoose.Error.ValidationError).errors ?? {},
    ).sort();
  }
}

const hotel = (overrides: Record<string, unknown> = {}) =>
  new HotelModel({
    name: 'Nile View',
    address: '1 Corniche St',
    cityId: '1818',
    countryCode: 'eg',
    timeZone: 'Africa/Cairo',
    ...overrides,
  });

const room = (overrides: Record<string, unknown> = {}) =>
  new RoomModel({
    hotelId: new Types.ObjectId(),
    number: ' 101 ',
    type: 'Double',
    beds: 2,
    maxOccupancy: 3,
    priceMinor: 12_000,
    ...overrides,
  });

const night = (overrides: Record<string, unknown> = {}) =>
  new RoomNightModel({
    roomId: new Types.ObjectId(),
    hotelId: new Types.ObjectId(),
    date: '2027-03-01',
    state: RoomNightState.Held,
    reservationId: new Types.ObjectId(),
    ...overrides,
  });

describe('hotels schema (TRVL-140, HTL-01/09/10)', () => {
  it('accepts a valid hotel with the defaults the ERD names', async () => {
    const doc = hotel();
    expect(await errorPaths(doc)).toEqual([]);
    expect(doc.countryCode).toBe('EG');
    expect(doc.isActive).toBe(true);
    expect(doc.images).toEqual([]);
    expect(doc.averageRating).toBeNull();
    expect(doc.ratingCount).toBe(0);
    expect(doc.starClass).toBeNull();
    expect(doc.policy).toMatchObject({
      cancellationTiers: [],
      checkInTime: null,
      checkOutTime: null,
    });
  });

  it('rejects a bad country code, an unknown time zone, more than 5 images and missing fields', async () => {
    expect(
      await errorPaths(
        hotel({
          countryCode: 'EGY',
          timeZone: 'Mars/Olympus',
          images: ['a', 'b', 'c', 'd', 'e', 'f'],
          name: undefined,
          address: undefined,
          cityId: undefined,
        }),
      ),
    ).toEqual([
      'address',
      'cityId',
      'countryCode',
      'images',
      'name',
      'timeZone',
    ]);
  });

  it('star class is a whole number 1..5 or null', async () => {
    expect(await errorPaths(hotel({ starClass: 4 }))).toEqual([]);
    expect(await errorPaths(hotel({ starClass: 0 }))).toEqual(['starClass']);
    expect(await errorPaths(hotel({ starClass: 6 }))).toEqual(['starClass']);
    expect(await errorPaths(hotel({ starClass: 3.5 }))).toEqual(['starClass']);
  });

  it('check-in/out times are HH:mm (HTL-09)', async () => {
    expect(
      await errorPaths(
        hotel({ policy: { checkInTime: '14:00', checkOutTime: '23:59' } }),
      ),
    ).toEqual([]);
    expect(
      await errorPaths(
        hotel({ policy: { checkInTime: '24:00', checkOutTime: '9:00' } }),
      ),
    ).toEqual(['policy.checkInTime', 'policy.checkOutTime']);
    expect(
      await errorPaths(
        hotel({ policy: { checkInTime: '', checkOutTime: null } }),
      ),
    ).toEqual(['policy.checkInTime']);
  });

  it('cancellation tiers: whole days >= 0, refund 0..100 (HTL-10)', async () => {
    expect(
      await errorPaths(
        hotel({
          policy: {
            cancellationTiers: [
              { daysBefore: 7, refundPercent: 50 },
              { daysBefore: 0, refundPercent: 0 },
            ],
          },
        }),
      ),
    ).toEqual([]);
    expect(
      await errorPaths(
        hotel({
          policy: {
            cancellationTiers: [{ daysBefore: 1.5, refundPercent: 101 }],
          },
        }),
      ),
    ).toEqual([
      'policy.cancellationTiers.0.daysBefore',
      'policy.cancellationTiers.0.refundPercent',
    ]);
  });

  it('average rating is 1..5 when set', async () => {
    expect(await errorPaths(hotel({ averageRating: 4.25 }))).toEqual([]);
    expect(await errorPaths(hotel({ averageRating: 0.5 }))).toEqual([
      'averageRating',
    ]);
  });
});

describe('rooms schema (TRVL-140, HTL-03/04)', () => {
  it('accepts a valid room, trims its number, defaults to active and never reserved', async () => {
    const doc = room();
    expect(await errorPaths(doc)).toEqual([]);
    expect(doc.number).toBe('101');
    expect(doc.isActive).toBe(true);
    expect(doc.everReserved).toBe(false);
  });

  it('beds and occupancy >= 1, price per night > 0, all whole numbers (HTL-03)', async () => {
    expect(
      await errorPaths(room({ beds: 0, maxOccupancy: 0, priceMinor: 0 })),
    ).toEqual(['beds', 'maxOccupancy', 'priceMinor']);
    expect(
      await errorPaths(
        room({ beds: 1.5, maxOccupancy: 2.5, priceMinor: 1e20 }),
      ),
    ).toEqual(['beds', 'maxOccupancy', 'priceMinor']);
  });

  it('availability ranges are real dates with to after from (HTL-04)', async () => {
    expect(
      await errorPaths(
        room({ availability: [{ from: '2027-01-01', to: '2027-03-01' }] }),
      ),
    ).toEqual([]);
    expect(
      await errorPaths(
        room({
          availability: [
            { from: '2027-03-01', to: '2027-03-01' },
            { from: '2027-02-30', to: '2027-03-05' },
          ],
        }),
      ),
    ).toEqual(['availability.0.to', 'availability.1.from']);
  });
});

describe('room_nights schema (TRVL-140, ADR-0002)', () => {
  it('a HELD or BOOKED night needs its reservation; a BLOCKED night has none', async () => {
    expect(await errorPaths(night())).toEqual([]);
    expect(
      await errorPaths(
        night({ state: RoomNightState.Booked, reference: 'H1234567' }),
      ),
    ).toEqual([]);
    expect(
      await errorPaths(
        night({ state: RoomNightState.Blocked, reservationId: null }),
      ),
    ).toEqual([]);
    expect(await errorPaths(night({ reservationId: null }))).toEqual([
      'reservationId',
    ]);
    expect(await errorPaths(night({ state: RoomNightState.Blocked }))).toEqual([
      'reservationId',
    ]);
  });

  it('a BOOKED night carries its reference (HTL-08); HELD and BLOCKED nights have none', async () => {
    expect(await errorPaths(night({ state: RoomNightState.Booked }))).toEqual([
      'reference',
    ]);
    expect(
      await errorPaths(night({ state: RoomNightState.Booked, reference: '' })),
    ).toEqual(['reference']);
    expect(await errorPaths(night({ reference: 'H1234567' }))).toEqual([
      'reference',
    ]);
  });

  it('rejects an unknown state and a malformed date', async () => {
    expect(
      await errorPaths(night({ state: 'FREE', date: '2027-13-01' })),
    ).toEqual(['date', 'state']);
  });
});

describe('reviews schema (TRVL-140, HTL-22)', () => {
  const review = (overrides: Record<string, unknown> = {}) =>
    new ReviewModel({
      hotelId: new Types.ObjectId(),
      reservationId: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      rating: 5,
      ...overrides,
    });

  it('accepts a 1..5 whole rating, defaults to visible with empty text', async () => {
    const doc = review();
    expect(await errorPaths(doc)).toEqual([]);
    expect(doc.isHidden).toBe(false);
    expect(doc.text).toBe('');
  });

  it('rejects ratings outside 1..5, fractions and text over 1000 characters', async () => {
    expect(await errorPaths(review({ rating: 0 }))).toEqual(['rating']);
    expect(await errorPaths(review({ rating: 4.5 }))).toEqual(['rating']);
    expect(await errorPaths(review({ text: 'x'.repeat(1001) }))).toEqual([
      'text',
    ]);
  });
});

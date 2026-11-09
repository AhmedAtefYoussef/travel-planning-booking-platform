import { model } from 'mongoose';
import { HotelSchema } from './hotel.schema';

/** Validation runs in memory; no database connection is needed. */
describe('HotelSchema', () => {
  const Hotel = model('HotelSchemaTest', HotelSchema);
  const valid = {
    name: 'Nile View',
    address: '1 Corniche St',
    cityId: 'cairo',
    countryCode: 'eg',
    photos: ['/uploads/a.jpg'],
    starClass: 4,
    checkInTime: '14:00',
    checkOutTime: '12:00',
    cancellationTiers: [{ daysBefore: 7, refundPercent: 100 }],
  };
  const errorsOf = (patch: Record<string, unknown>) =>
    Object.keys(new Hotel({ ...valid, ...patch }).validateSync()?.errors ?? {});

  it('accepts a valid hotel and applies defaults', () => {
    const doc = new Hotel(valid);
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.countryCode).toBe('EG');
    expect(doc.active).toBe(true);
    expect(doc.ratingAvg).toBe(0);
    expect(doc.ratingCount).toBe(0);
    expect(doc.amenities).toEqual([]);
  });

  it.each(['name', 'address', 'cityId', 'countryCode'])(
    'requires %s',
    (field) => {
      expect(errorsOf({ [field]: undefined })).toContain(field);
    },
  );

  it('allows 5 photos and rejects 6', () => {
    const photo = '/uploads/p.jpg';
    expect(errorsOf({ photos: Array(5).fill(photo) })).toEqual([]);
    expect(errorsOf({ photos: Array(6).fill(photo) })).toContain('photos');
  });

  it.each(['24:00', '9:00', '12:60', 'noon'])(
    'rejects check-in time %s',
    (time) => {
      expect(errorsOf({ checkInTime: time })).toContain('checkInTime');
    },
  );

  it.each([1, 5])('accepts star class %d', (starClass) => {
    expect(errorsOf({ starClass })).toEqual([]);
  });

  it.each([0, 6, 3.5])('rejects star class %p', (starClass) => {
    expect(errorsOf({ starClass })).toContain('starClass');
  });

  it.each([
    [{ daysBefore: 3, refundPercent: 101 }, 'refundPercent'],
    [{ daysBefore: 3, refundPercent: -1 }, 'refundPercent'],
    [{ daysBefore: -1, refundPercent: 50 }, 'daysBefore'],
    [{ daysBefore: 1.5, refundPercent: 50 }, 'daysBefore'],
  ])('rejects cancellation tier %o', (tier, field) => {
    expect(errorsOf({ cancellationTiers: [tier] })).toContain(
      `cancellationTiers.0.${field}`,
    );
  });

  it('indexes city and country search on active hotels', () => {
    const keys = HotelSchema.indexes().map(([fields]) => fields);
    expect(keys).toContainEqual({ cityId: 1, active: 1 });
    expect(keys).toContainEqual({ countryCode: 1, active: 1 });
  });
});

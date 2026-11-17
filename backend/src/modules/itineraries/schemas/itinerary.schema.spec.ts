import { model, Types } from 'mongoose';
import {
  ItinerarySchema,
  ItineraryVisibility,
  MAX_ITINERARY_DAYS,
} from './itinerary.schema';

describe('ItinerarySchema', () => {
  const ItineraryModel = model('ItinerarySchemaTest', ItinerarySchema);
  const valid = {
    ownerId: new Types.ObjectId(),
    title: 'Cairo and Luxor',
    countries: ['EG'],
    startDate: '2026-12-01',
    days: [
      { order: 1, cityId: 'cairo', notes: 'Arrive' },
      { order: 2, cityId: 'luxor', notes: '' },
    ],
  };
  const errorsOf = (patch: Record<string, unknown>) =>
    Object.keys(
      new ItineraryModel({ ...valid, ...patch }).validateSync()?.errors ?? {},
    );

  it('accepts the itinerary and applies visibility, hidden, timestamps and embedded day ids', () => {
    const doc = new ItineraryModel(valid);
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.visibility).toBe(ItineraryVisibility.Private);
    expect(doc.isHidden).toBe(false);
    expect(doc.days[0]._id).toBeInstanceOf(Types.ObjectId);
    expect(doc.ownerId).toBeInstanceOf(Types.ObjectId);
  });

  it.each(['ownerId', 'title', 'countries', 'startDate'])(
    'requires %s',
    (field) => expect(errorsOf({ [field]: undefined })).toContain(field),
  );

  it('rejects overlong titles, invalid country codes and invalid calendar dates', () => {
    expect(errorsOf({ title: 'x'.repeat(101) })).toContain('title');
    expect(errorsOf({ countries: ['usa'] })).toContain('countries');
    expect(errorsOf({ countries: [] })).toContain('countries');
    expect(errorsOf({ startDate: '2026-02-30' })).toContain('startDate');
  });

  it('rejects unsupported visibility values', () => {
    expect(errorsOf({ visibility: 'UNLISTED' })).toContain('visibility');
  });

  it.each([
    [{ order: 2, cityId: 'cairo' }, 'days'],
    [
      [
        { order: 1, cityId: 'cairo' },
        { order: 1, cityId: 'luxor' },
      ],
      'days',
    ],
    [
      [
        { order: 1, cityId: 'cairo' },
        { order: 3, cityId: 'luxor' },
      ],
      'days',
    ],
    [
      Array.from({ length: MAX_ITINERARY_DAYS + 1 }, (_, i) => ({
        order: i + 1,
        cityId: 'cairo',
      })),
      'days',
    ],
  ])('rejects non-sequential or oversized days %p', (days, field) => {
    expect(errorsOf({ days })).toContain(field);
  });

  it('requires cityId on each day and validates clone attribution references', () => {
    expect(errorsOf({ days: [{ order: 1 }] })).toContain('days.0.cityId');
    const clone = new ItineraryModel({
      ...valid,
      clonedFrom: {
        itineraryId: new Types.ObjectId(),
        authorId: new Types.ObjectId(),
        authorName: 'Original Author',
      },
    });
    expect(clone.validateSync()).toBeUndefined();
    expect(clone.clonedFrom?.itineraryId).toBeInstanceOf(Types.ObjectId);
  });

 it('declares owner/update and public browsing indexes', () => {
  const keys = ItinerarySchema.indexes().map(([fields]) => fields);

  expect(keys).toContainEqual({
    ownerId: 1,
    updatedAt: -1,
  });

  expect(keys).toContainEqual({
    visibility: 1,
    isHidden: 1,
    updatedAt: -1,
  });

  expect(
    keys.some((index) => Object.values(index).includes('text')),
  ).toBe(false);
});
});

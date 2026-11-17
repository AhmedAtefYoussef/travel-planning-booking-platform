import { model, Types } from 'mongoose';
import { UPLOAD_LIMITS } from '../../../common/contracts';
import { ActivitySchema } from './activity.schema';

describe('ActivitySchema', () => {
  const ActivityModel = model('ActivitySchemaTest', ActivitySchema);

  const validImageUrl =
    '/uploads/activities/550e8400-e29b-41d4-a716-446655440000.jpg';

  const valid = {
    itineraryId: new Types.ObjectId(),
    dayId: new Types.ObjectId(),
    name: 'Visit the Egyptian Museum',
    description: 'Explore the exhibits.',
    images: [validImageUrl],
  };

  const errorsOf = (patch: Record<string, unknown>) =>
    Object.keys(
      new ActivityModel({ ...valid, ...patch }).validateSync()?.errors ?? {},
    );

  it('accepts activity references and defaults images', () => {
    const doc = new ActivityModel({ ...valid, images: undefined });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.itineraryId).toBeInstanceOf(Types.ObjectId);
    expect(doc.dayId).toBeInstanceOf(Types.ObjectId);
    expect(doc.images).toEqual([]);
  });

  it.each(['itineraryId', 'dayId', 'name', 'description'])(
    'requires %s',
    (field) => expect(errorsOf({ [field]: undefined })).toContain(field),
  );

  it('validates time, integer minor-unit cost and uppercase currency format', () => {
    expect(errorsOf({ time: '24:00' })).toContain('time');
    expect(errorsOf({ costMinor: -1 })).toContain('costMinor');
    expect(errorsOf({ costMinor: 10.5 })).toContain('costMinor');

    expect(errorsOf({ currency: 'usd', costMinor: 1250 })).toEqual([]);

    expect(errorsOf({ currency: 'US', costMinor: 1250 })).toContain('currency');

    const doc = new ActivityModel({
      ...valid,
      currency: 'usd',
      costMinor: 1250,
      time: '09:30',
    });

    expect(doc.validateSync()).toBeUndefined();
    expect(doc.currency).toBe('USD');
  });

  it('requires costMinor and currency to be provided together', async () => {
    const costOnly = new ActivityModel({ ...valid, costMinor: 1250 });

    await expect(costOnly.validate()).rejects.toMatchObject({
      errors: expect.objectContaining({
        currency: expect.anything(),
      }),
    });

    const currencyOnly = new ActivityModel({ ...valid, currency: 'USD' });

    await expect(currencyOnly.validate()).rejects.toMatchObject({
      errors: expect.objectContaining({
        costMinor: expect.anything(),
      }),
    });

    const both = new ActivityModel({
      ...valid,
      costMinor: 1250,
      currency: 'USD',
    });

    await expect(both.validate()).resolves.toBeUndefined();
  });

  it('limits stored image URLs to the shared activity upload maximum', () => {
    expect(
      errorsOf({
        images: Array(UPLOAD_LIMITS.maxImagesPerEntity).fill(validImageUrl),
      }),
    ).toEqual([]);

    expect(
      errorsOf({
        images: Array(UPLOAD_LIMITS.maxImagesPerEntity + 1).fill(validImageUrl),
      }),
    ).toContain('images');
  });

  it('rejects invalid activity image URLs', () => {
    expect(errorsOf({ images: ['/uploads/activities/museum.jpg'] })).toContain(
      'images',
    );

    expect(errorsOf({ images: ['https://example.com/museum.jpg'] })).toContain(
      'images',
    );
  });

  it('indexes activities by itinerary and embedded day id', () => {
    expect(ActivitySchema.indexes().map(([fields]) => fields)).toContainEqual({
      itineraryId: 1,
      dayId: 1,
    });
  });
});

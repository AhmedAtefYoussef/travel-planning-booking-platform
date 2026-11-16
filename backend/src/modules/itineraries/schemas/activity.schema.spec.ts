import { model, Types } from 'mongoose';
import { ActivitySchema, MAX_ACTIVITY_IMAGES } from './activity.schema';

describe('ActivitySchema', () => {
  const ActivityModel = model('ActivitySchemaTest', ActivitySchema);
  const valid = {
    itineraryId: new Types.ObjectId(),
    dayId: new Types.ObjectId(),
    name: 'Visit the Egyptian Museum',
    description: 'Explore the exhibits.',
    images: ['/uploads/activities/museum.jpg'],
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
    expect(errorsOf({ currency: 'usd' })).toEqual([]);
    expect(errorsOf({ currency: 'US' })).toContain('currency');
    const doc = new ActivityModel({
      ...valid,
      currency: 'usd',
      costMinor: 1250,
      time: '09:30',
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.currency).toBe('USD');
  });

  it('limits stored image URLs to the shared activity upload maximum', () => {
    expect(
      errorsOf({
        images: Array(MAX_ACTIVITY_IMAGES).fill('/uploads/activities/a.jpg'),
      }),
    ).toEqual([]);
    expect(
      errorsOf({
        images: Array(MAX_ACTIVITY_IMAGES + 1).fill(
          '/uploads/activities/a.jpg',
        ),
      }),
    ).toContain('images');
  });

  it('indexes activities by itinerary and embedded day id', () => {
    expect(ActivitySchema.indexes().map(([fields]) => fields)).toContainEqual({
      itineraryId: 1,
      dayId: 1,
    });
  });
});

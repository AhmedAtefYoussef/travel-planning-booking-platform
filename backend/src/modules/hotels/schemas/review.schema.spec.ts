import { model, Types } from 'mongoose';
import { MAX_REVIEW_TEXT, ReviewSchema } from './review.schema';

describe('ReviewSchema', () => {
  const Review = model('ReviewSchemaTest', ReviewSchema);
  const valid = {
    hotelId: new Types.ObjectId(),
    reservationId: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    rating: 5,
    text: 'Great stay',
  };
  const errorsOf = (patch: Record<string, unknown>) =>
    Object.keys(
      new Review({ ...valid, ...patch }).validateSync()?.errors ?? {},
    );

  it('accepts a valid review and defaults isHidden to false', () => {
    const doc = new Review(valid);
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.isHidden).toBe(false);
  });

  it.each(['hotelId', 'reservationId', 'userId', 'rating'])(
    'requires %s',
    (field) => {
      expect(errorsOf({ [field]: undefined })).toContain(field);
    },
  );

  it.each([1, 5])('accepts rating %d', (rating) => {
    expect(errorsOf({ rating })).toEqual([]);
  });

  it.each([0, 6, 4.5])('rejects rating %p', (rating) => {
    expect(errorsOf({ rating })).toContain('rating');
  });

  it('allows 1000 characters of text and rejects 1001', () => {
    expect(errorsOf({ text: 'a'.repeat(MAX_REVIEW_TEXT) })).toEqual([]);
    expect(errorsOf({ text: 'a'.repeat(MAX_REVIEW_TEXT + 1) })).toContain(
      'text',
    );
  });

  it('declares a unique index on reservationId', () => {
    expect(ReviewSchema.indexes()).toContainEqual([
      { reservationId: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });

  it('indexes reviews per hotel, newest first', () => {
    const keys = ReviewSchema.indexes().map(([fields]) => fields);
    expect(keys).toContainEqual({ hotelId: 1, createdAt: -1 });
  });
});

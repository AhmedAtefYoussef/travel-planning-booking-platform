import { model, Types } from 'mongoose';
import { RoomSchema } from './room.schema';

describe('RoomSchema', () => {
  const Room = model('RoomSchemaTest', RoomSchema);
  const valid = {
    hotelId: new Types.ObjectId(),
    number: '101',
    type: 'Double',
    beds: 2,
    maxOccupancy: 3,
    priceMinor: 12_000,
    availability: [{ from: '2026-12-01', to: '2026-12-31' }],
  };
  const errorsOf = (patch: Record<string, unknown>) =>
    Object.keys(new Room({ ...valid, ...patch }).validateSync()?.errors ?? {});

  it('accepts a valid room and applies defaults', () => {
    const doc = new Room(valid);
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.hotelId).toBeInstanceOf(Types.ObjectId);
    expect(doc.isActive).toBe(true);
    expect(doc.everReserved).toBe(false);
  });

  it.each(['hotelId', 'number', 'type', 'beds', 'maxOccupancy', 'priceMinor'])(
    'requires %s',
    (field) => {
      expect(errorsOf({ [field]: undefined })).toContain(field);
    },
  );

  it('rejects a hotelId that is not an ObjectId', () => {
    expect(errorsOf({ hotelId: 'not-an-id' })).toContain('hotelId');
  });

  it.each([
    ['beds', 0],
    ['beds', 1.5],
    ['maxOccupancy', 0],
    ['priceMinor', 0],
    ['priceMinor', -1],
    ['priceMinor', 99.5],
  ])('rejects %s = %p', (field, value) => {
    expect(errorsOf({ [field]: value })).toContain(field);
  });

  it.each([
    [{ from: '2026-12-10', to: '2026-12-10' }, 'availability.0.to'],
    [{ from: '2026-12-10', to: '2026-12-01' }, 'availability.0.to'],
    [{ from: '2026-02-30', to: '2026-03-05' }, 'availability.0.from'],
    [{ from: '2026-12-01', to: '31/12/2026' }, 'availability.0.to'],
  ])('rejects availability range %o', (range, path) => {
    expect(errorsOf({ availability: [range] })).toContain(path);
  });

  it('declares a unique index on {hotelId, number}', () => {
    expect(RoomSchema.indexes()).toContainEqual([
      { hotelId: 1, number: 1 },
      expect.objectContaining({
        unique: true,
        collation: { locale: 'en', strength: 2 },
      }),
    ]);
  });
});

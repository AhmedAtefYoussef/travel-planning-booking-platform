import { model, Types } from 'mongoose';
import { RoomNightKind, RoomNightSchema } from './room-night.schema';

describe('RoomNightSchema', () => {
  const RoomNight = model('RoomNightSchemaTest', RoomNightSchema);
  const valid = {
    roomId: new Types.ObjectId(),
    hotelId: new Types.ObjectId(),
    date: '2026-12-24',
    kind: RoomNightKind.BLOCKED,
  };
  const errorsOf = (patch: Record<string, unknown>) =>
    Object.keys(
      new RoomNight({ ...valid, ...patch }).validateSync()?.errors ?? {},
    );

  it('accepts a BLOCKED night with no reservation', () => {
    const doc = new RoomNight(valid);
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.reservationId).toBeNull();
    expect(doc.reference).toBeNull();
    expect(doc.expiresAt).toBeNull();
  });

  it('accepts a HELD night linked to a reservation', () => {
    const doc = new RoomNight({
      ...valid,
      kind: RoomNightKind.HELD,
      reservationId: new Types.ObjectId(),
      reference: 'HTL-ABC123',
      expiresAt: new Date(),
    });
    expect(doc.validateSync()).toBeUndefined();
  });

  it.each(['roomId', 'hotelId', 'date', 'kind'])('requires %s', (field) => {
    expect(errorsOf({ [field]: undefined })).toContain(field);
  });

  it('rejects an unknown kind', () => {
    expect(errorsOf({ kind: 'RESERVED' })).toContain('kind');
  });

  it.each(['2026-13-01', '2026-12-24T00:00:00Z', '24/12/2026'])(
    'rejects date %s',
    (date) => {
      expect(errorsOf({ date })).toContain('date');
    },
  );

  it('declares a unique index on {roomId, date}', () => {
    expect(RoomNightSchema.indexes()).toContainEqual([
      { roomId: 1, date: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });
});

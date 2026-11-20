import { Types } from 'mongoose';
import { RoomNightStatus } from './dto/room-calendar.dto';
import { nightStatus } from './room-calendar.service';
import { RoomNightKind } from './schemas/room-night.schema';

const room = {
  isActive: true,
  availability: [{ from: '2027-01-01', to: '2027-01-10' }],
};
const taken = (kind: RoomNightKind, extra: object = {}) => ({
  roomId: new Types.ObjectId(),
  date: '2027-01-05',
  kind,
  reference: null,
  expiresAt: null,
  ...extra,
});

describe('room status per night (HTL-08)', () => {
  it('a free night inside a bookable range is AVAILABLE; outside it is NOT_BOOKABLE', () => {
    expect(nightStatus(room, '2027-01-05').status).toBe(
      RoomNightStatus.AVAILABLE,
    );
    expect(nightStatus(room, '2027-01-10').status).toBe(
      RoomNightStatus.NOT_BOOKABLE,
    );
  });

  it('a deactivated room is NOT_BOOKABLE on free nights', () => {
    expect(nightStatus({ ...room, isActive: false }, '2027-01-05').status).toBe(
      RoomNightStatus.NOT_BOOKABLE,
    );
  });

  it('BOOKED shows the reservation reference; HELD shows when the hold ends', () => {
    expect(
      nightStatus(
        room,
        '2027-01-05',
        taken(RoomNightKind.BOOKED, { reference: 'HT-ABC' }),
      ),
    ).toEqual({
      date: '2027-01-05',
      status: RoomNightStatus.BOOKED,
      reference: 'HT-ABC',
      holdExpiresAt: null,
    });
    const until = new Date('2027-01-01T10:10:00Z');
    expect(
      nightStatus(
        room,
        '2027-01-05',
        taken(RoomNightKind.HELD, { expiresAt: until }),
      ),
    ).toMatchObject({ status: RoomNightStatus.HELD, holdExpiresAt: until });
  });

  it('BLOCKED wins over the bookable range, and a stay shows even on a deactivated room', () => {
    expect(
      nightStatus(room, '2027-01-05', taken(RoomNightKind.BLOCKED)).status,
    ).toBe(RoomNightStatus.BLOCKED);
    expect(
      nightStatus(
        { ...room, isActive: false },
        '2027-01-05',
        taken(RoomNightKind.BOOKED),
      ).status,
    ).toBe(RoomNightStatus.BOOKED);
  });
});

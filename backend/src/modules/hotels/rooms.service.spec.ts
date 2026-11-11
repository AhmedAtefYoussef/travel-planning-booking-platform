import { Types, type Model } from 'mongoose';
import { AuthUser, ProviderType, Role } from '../../common/auth/auth.types';
import { assertProviderScope } from '../../common/auth/access';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { HotelsService } from './hotels.service';
import type { Room } from './schemas/room.schema';
import { RoomsService } from './rooms.service';

const hotelId = new Types.ObjectId();
const now = new Date('2026-11-09T10:00:00Z');
const dto = {
  number: '101',
  type: 'Double',
  beds: 2,
  maxOccupancy: 3,
  priceMinor: 10000,
};

function setup(hotel: { _id: Types.ObjectId } | AppException) {
  const model = {
    create: jest.fn((doc: Record<string, unknown>) =>
      Promise.resolve({
        id: new Types.ObjectId().toHexString(),
        availability: [],
        isActive: true,
        createdAt: now,
        updatedAt: now,
        ...doc,
      }),
    ),
  };
  const hotels = {
    // Same order as HotelsService.loadManaged: provider scope first, then the hotel's own state.
    loadManaged: jest.fn((user: AuthUser, id: string) => {
      assertProviderScope(user, ProviderType.Hotel, id);
      return hotel instanceof AppException
        ? Promise.reject(hotel)
        : Promise.resolve(hotel);
    }),
  };
  return {
    model,
    hotels,
    service: new RoomsService(
      model as unknown as Model<Room>,
      hotels as unknown as HotelsService,
    ),
  };
}

const moderatorOf = (id: Types.ObjectId): AuthUser => ({
  id: new Types.ObjectId().toHexString(),
  role: Role.HotelModerator,
  assignedProvider: { type: ProviderType.Hotel, providerId: id.toHexString() },
});

describe('RoomsService (HTL-03)', () => {
  it('lets the assigned moderator add a room with no bookable dates', async () => {
    const { service, model } = setup({ _id: hotelId });
    const room = await service.create(
      moderatorOf(hotelId),
      hotelId.toHexString(),
      dto,
    );
    expect(model.create).toHaveBeenCalledWith({ hotelId, ...dto });
    expect(room).toMatchObject({
      hotelId: hotelId.toHexString(),
      number: '101',
      priceMinor: 10000,
      availability: [],
      isActive: true,
    });
  });

  it("refuses another hotel's moderator, an admin and a traveller with 403", async () => {
    const { service, model } = setup({ _id: hotelId });
    const others: AuthUser[] = [
      moderatorOf(new Types.ObjectId()),
      { id: new Types.ObjectId().toHexString(), role: Role.Admin },
      { id: new Types.ObjectId().toHexString(), role: Role.User },
    ];
    for (const user of others) {
      await expect(
        service.create(user, hotelId.toHexString(), dto),
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(model.create).not.toHaveBeenCalled();
  });

  it('passes on a missing or deactivated hotel (404 / 403) without creating', async () => {
    for (const status of [404, 403]) {
      const { service, model } = setup(
        new AppException(status, ErrorCode.NOT_FOUND, 'nope'),
      );
      await expect(
        service.create(moderatorOf(hotelId), hotelId.toHexString(), dto),
      ).rejects.toMatchObject({ status });
      expect(model.create).not.toHaveBeenCalled();
    }
  });
});

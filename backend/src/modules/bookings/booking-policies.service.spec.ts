import { Types } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import {
  BookingStatus,
  BookingType,
  policiesVersion,
  type HotelPolicySnapshot,
} from '../../common/contracts';
import { BookingPoliciesService } from './booking-policies.service';

const NOW = new Date('2027-11-01T08:00:00Z');
const user = {
  id: new Types.ObjectId().toHexString(),
  role: Role.User,
} as AuthUser;
const id = new Types.ObjectId().toHexString();
const hotel: HotelPolicySnapshot = {
  hotelId: new Types.ObjectId().toHexString(),
  hotelName: 'Nile View',
  cancellationTiers: [],
  checkInTime: null,
  checkOutTime: null,
};
const version = policiesVersion({ hotel });

function booking(over: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(id),
    userId: new Types.ObjectId(user.id),
    hotelId: new Types.ObjectId(hotel.hotelId),
    status: BookingStatus.PendingPayment,
    holdExpiresAt: new Date(NOW.getTime() + 60_000),
    policiesAcceptedAt: null,
    policySnapshot: null,
    ...over,
  };
}

function setup(reads: unknown[], modified = 1, policy: unknown = hotel) {
  const queue = [...reads];
  const hotels = {
    findById: jest.fn(() => ({
      lean: () => ({ exec: () => Promise.resolve(queue.shift() ?? null) }),
    })),
    updateOne: jest.fn(() => ({
      exec: () => Promise.resolve({ modifiedCount: modified }),
    })),
  };
  const hotelInventory = {
    getHotelPolicy: jest.fn().mockResolvedValue(policy),
  };
  const service = new BookingPoliciesService(
    {} as never,
    hotels as never,
    {} as never,
    hotelInventory as never,
  );
  return { service, hotels };
}

describe('BookingPoliciesService: PAY-02', () => {
  it('returns the winner when a concurrent request accepted between the read and the write', async () => {
    const acceptedAt = new Date(NOW.getTime() - 500);
    const { service } = setup(
      [
        booking(),
        booking({
          policiesAcceptedAt: acceptedAt,
          policySnapshot: { hotel, version },
        }),
      ],
      0,
    );
    await expect(
      service.accept(
        user,
        BookingType.Hotel,
        id,
        { accepted: true, version },
        NOW,
      ),
    ).resolves.toMatchObject({ accepted: true, acceptedAt });
  });

  it('reports a hold that expired between the read and the write as HOLD_EXPIRED', async () => {
    const { service } = setup(
      [booking(), booking({ status: BookingStatus.Expired })],
      0,
    );
    await expect(
      service.accept(
        user,
        BookingType.Hotel,
        id,
        { accepted: true, version },
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'HOLD_EXPIRED' });
  });

  it('refuses a paid booking with INVALID_STATE_TRANSITION', async () => {
    const { service, hotels } = setup([
      booking({ status: BookingStatus.Confirmed }),
    ]);
    await expect(
      service.accept(
        user,
        BookingType.Hotel,
        id,
        { accepted: true, version },
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    expect(hotels.updateOne).not.toHaveBeenCalled();
  });

  it('answers 409 when the provider no longer exists, rather than accepting empty terms', async () => {
    const { service } = setup([booking()], 1, null);
    await expect(
      service.show(user, BookingType.Hotel, id),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('answers 404 for a malformed id without reading the database', async () => {
    const { service, hotels } = setup([]);
    await expect(
      service.show(user, BookingType.Hotel, 'nope'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(hotels.findById).not.toHaveBeenCalled();
  });

  it('refuses a repeat with another version than the stored one (POLICIES_CHANGED)', async () => {
    const { service } = setup([
      booking({
        policiesAcceptedAt: new Date(NOW.getTime() - 500),
        policySnapshot: { hotel, version },
      }),
    ]);
    await expect(
      service.accept(
        user,
        BookingType.Hotel,
        id,
        { accepted: true, version: 'ffffffffffffffff' },
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'POLICIES_CHANGED' });
  });

  it('logs a timestamp stored without terms and lets the owner accept again to repair it', async () => {
    const { service, hotels } = setup([
      booking({ policiesAcceptedAt: new Date(NOW.getTime() - 500) }),
    ]);
    const error = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);
    const dto = await service.accept(
      user,
      BookingType.Hotel,
      id,
      { accepted: true, version },
      NOW,
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('no stored policy terms'),
    );
    expect(dto.accepted).toBe(true);
    expect(hotels.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: [{ policiesAcceptedAt: null }, { policySnapshot: null }],
      }),
      expect.anything(),
    );
  });
});

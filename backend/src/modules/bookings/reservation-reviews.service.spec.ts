import { Types } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import { BookingStatus } from '../../common/contracts';
import { ReservationReviewsService } from './reservation-reviews.service';

const NOW = new Date('2027-11-01T08:00:00Z');
const OWNER = new Types.ObjectId();
const HOTEL = new Types.ObjectId();
const RESERVATION = new Types.ObjectId();
const owner: AuthUser = { id: OWNER.toHexString(), role: Role.User };

function setup(reservation: object | null) {
  const reservations = {
    findById: jest.fn(() => ({
      lean: () => ({ exec: () => Promise.resolve(reservation) }),
    })),
    updateOne: jest.fn(() => ({
      exec: () => Promise.resolve({ modifiedCount: 1 }),
    })),
  };
  const reviews = {
    create: jest.fn(() => Promise.resolve({ id: 'r1', rating: 5 })),
  };
  const service = new ReservationReviewsService(
    reservations as never,
    reviews as never,
  );
  return { service, reservations, reviews };
}

const stay = (status: BookingStatus, endsAt: Date) => ({
  _id: RESERVATION,
  userId: OWNER,
  hotelId: HOTEL,
  status,
  endsAt,
  checkOut: '2027-10-31',
});

describe('ReservationReviewsService (HTL-23, GEN-11)', () => {
  it('reviews a Completed stay of the caller through the hotels module', async () => {
    const { service, reviews, reservations } = setup(
      stay(BookingStatus.Completed, new Date('2027-10-31T22:00:00Z')),
    );
    await service.submit(owner, RESERVATION.toHexString(), { rating: 5 }, NOW);
    expect(reservations.updateOne).not.toHaveBeenCalled();
    expect(reviews.create).toHaveBeenCalledWith(
      {
        hotelId: HOTEL.toHexString(),
        reservationId: RESERVATION.toHexString(),
        userId: OWNER.toHexString(),
      },
      { rating: 5 },
    );
  });

  it('completes a Confirmed stay whose check-out day has passed, then reviews it', async () => {
    const { service, reviews, reservations } = setup(
      stay(BookingStatus.Confirmed, NOW),
    );
    await service.submit(owner, RESERVATION.toHexString(), { rating: 4 }, NOW);
    expect(reservations.updateOne).toHaveBeenCalledWith(
      {
        endsAt: { $lte: NOW },
        _id: RESERVATION.toHexString(),
        status: BookingStatus.Confirmed,
      },
      { $set: { status: BookingStatus.Completed } },
      {},
    );
    expect(reviews.create).toHaveBeenCalled();
  });

  it.each([
    [BookingStatus.Confirmed, new Date(NOW.getTime() + 1)],
    [BookingStatus.PendingPayment, new Date(NOW.getTime() + 1)],
    [BookingStatus.Cancelled, new Date(NOW.getTime() - 1)],
    [BookingStatus.Expired, new Date(NOW.getTime() - 1)],
  ])(
    'refuses a %s reservation with 409 RESERVATION_NOT_COMPLETED',
    async (status, endsAt) => {
      const { service, reviews } = setup(stay(status, endsAt));
      await expect(
        service.submit(owner, RESERVATION.toHexString(), { rating: 4 }, NOW),
      ).rejects.toMatchObject({ code: 'RESERVATION_NOT_COMPLETED' });
      expect(reviews.create).not.toHaveBeenCalled();
    },
  );

  it("answers someone else's reservation exactly like an unknown one (404, ACC-11)", async () => {
    const stranger: AuthUser = {
      id: new Types.ObjectId().toHexString(),
      role: Role.User,
    };
    const theirs = setup(
      stay(BookingStatus.Completed, new Date(NOW.getTime() - 1)),
    );
    const unknown = setup(null);
    const a = await theirs.service
      .submit(stranger, RESERVATION.toHexString(), { rating: 4 }, NOW)
      .catch((e: unknown) => e);
    const b = await unknown.service
      .submit(stranger, RESERVATION.toHexString(), { rating: 4 }, NOW)
      .catch((e: unknown) => e);
    expect(a).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Booking not found',
    });
    expect(b).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Booking not found',
    });
  });
});

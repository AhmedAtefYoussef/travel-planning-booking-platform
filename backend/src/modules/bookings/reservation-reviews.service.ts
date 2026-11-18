import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { assertOwner } from '../../common/auth/access';
import type { AuthUser } from '../../common/auth/auth.types';
import { BookingStatus, transitionBooking } from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  ReviewsService,
  type CreateReviewDto,
  type ReviewDto,
} from '../hotels';
import { HotelReservation } from './schemas/hotel-reservation.schema';

const NOT_FOUND = 'Booking not found';

/**
 * HTL-23: a review needs a Completed reservation of the caller (GEN-11). A Confirmed reservation
 * becomes Completed once its check-out date has passed; the lifecycle job does that every minute, and a
 * review submitted in between completes it on the spot, through the same status-conditioned transition
 * (`endsAt` is the end of the check-out day in the hotel's zone). The review itself is written by the
 * hotels module, which owns the reviews and the hotel rating.
 */
@Injectable()
export class ReservationReviewsService {
  constructor(
    @InjectModel(HotelReservation.name)
    private readonly reservations: Model<HotelReservation>,
    private readonly reviews: ReviewsService,
  ) {}

  async submit(
    user: AuthUser,
    reservationId: string,
    dto: CreateReviewDto,
    now: Date = new Date(),
  ): Promise<ReviewDto> {
    const reservation = Types.ObjectId.isValid(reservationId)
      ? await this.reservations
          .findById(reservationId, {
            userId: 1,
            hotelId: 1,
            status: 1,
            endsAt: 1,
            checkOut: 1,
          })
          .lean()
          .exec()
      : null;
    if (!reservation) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        NOT_FOUND,
      );
    }
    // ACC-11: someone else's reservation answers exactly like an unknown one.
    assertOwner(user, reservation.userId, {
      notFound: true,
      notFoundMessage: NOT_FOUND,
    });
    if (
      reservation.status === BookingStatus.Confirmed &&
      reservation.endsAt <= now
    ) {
      await transitionBooking(
        this.reservations,
        reservationId,
        BookingStatus.Confirmed,
        BookingStatus.Completed,
        { where: { endsAt: { $lte: now } } },
      );
    } else if (reservation.status !== BookingStatus.Completed) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.RESERVATION_NOT_COMPLETED,
        reservation.status === BookingStatus.Confirmed
          ? `A stay can be reviewed once it is completed, after its check-out date (${reservation.checkOut})`
          : `This reservation is ${reservation.status}; only a completed stay can be reviewed`,
      );
    }
    return this.reviews.create(
      {
        hotelId: reservation.hotelId.toHexString(),
        reservationId,
        userId: user.id,
      },
      dto,
    );
  }
}

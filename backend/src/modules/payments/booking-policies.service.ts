import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import {
  BookingType,
  FLIGHT_PAYABLE_BOOKING,
  HOTEL_PAYABLE_BOOKING,
  type BookingPolicies,
  type PayableBooking,
} from '../../common/contracts';
import {
  AppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

/** The :type path segment of /api/bookings/:type/:id/... */
export const BOOKING_TYPE_PATHS: Record<string, BookingType> = {
  flight: BookingType.Flight,
  hotel: BookingType.Hotel,
};

/**
 * Finds the module that owns a booking type. Flight bookings and hotel reservations implement the
 * same PayableBooking contract, so payments never import their internals (ADR-0005). Hotel
 * reservations arrive with HTL-18; until then the hotel provider is absent and requests are 404.
 */
@Injectable()
export class PayableBookings {
  constructor(
    @Optional()
    @Inject(FLIGHT_PAYABLE_BOOKING)
    private readonly flights?: PayableBooking,
    @Optional()
    @Inject(HOTEL_PAYABLE_BOOKING)
    private readonly hotels?: PayableBooking,
  ) {}

  /** The provider for a type, or 404 when that kind of booking does not exist (yet). */
  of(type: BookingType): PayableBooking {
    const provider = type === BookingType.Flight ? this.flights : this.hotels;
    if (!provider) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Booking not found',
      );
    }
    return provider;
  }
}

/**
 * PAY-02: shows the provider policies captured on the booking (airline: cancellation tiers and
 * baggage; hotel: cancellation tiers and check-in/check-out times) and records the user's acceptance
 * with a timestamp. Payment (PAY-01) is refused while the acceptance is missing.
 */
@Injectable()
export class BookingPoliciesService {
  constructor(private readonly payables: PayableBookings) {}

  get(
    type: BookingType,
    bookingId: string,
    userId: string,
  ): Promise<BookingPolicies> {
    return this.payables.of(type).getPolicies(bookingId, userId);
  }

  /** `accepted` is the checkbox; checked here too so no caller can skip it (GEN-13). */
  accept(
    type: BookingType,
    bookingId: string,
    userId: string,
    accepted: boolean,
  ): Promise<BookingPolicies> {
    if (accepted !== true) {
      throw new ValidationFailedException([
        {
          field: 'accepted',
          message: 'accepted must be true to accept the policies',
        },
      ]);
    }
    return this.payables.of(type).acceptPolicies(bookingId, userId);
  }
}

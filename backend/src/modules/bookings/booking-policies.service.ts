import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  BookingStatus,
  BookingType,
  FLIGHT_INVENTORY,
  HOTEL_INVENTORY,
  policiesVersion,
  type FlightInventory,
  type HotelInventory,
  type PolicySnapshot,
  type ProviderPolicies,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type {
  AcceptPoliciesDto,
  BookingPoliciesDto,
} from './dto/booking-policies.dto';
import { FlightBooking } from './schemas/flight-booking.schema';
import { HotelReservation } from './schemas/hotel-reservation.schema';

/** What both booking collections share for PAY-02. */
interface PolicyTarget {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  status: BookingStatus;
  holdExpiresAt: Date;
  policiesAcceptedAt: Date | null;
  policySnapshot: PolicySnapshot | null;
}

/** The two calls PAY-02 makes, common to both booking models. */
interface BookingModel {
  findById(
    id: string,
    projection: Record<string, 1>,
  ): { lean(): { exec(): Promise<unknown> } };
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): { exec(): Promise<{ modifiedCount: number }> };
}

/**
 * PAY-02: shows the provider's policies for one booking (airline: cancellation and baggage; hotel:
 * cancellation and check-in/check-out times) and records the user's acceptance with a timestamp and a
 * snapshot of exactly those terms. PAY-01 refuses payment until then (assertPayable). PAY-03 refunds
 * from the snapshot, so a later policy change never alters this booking's refund.
 */
@Injectable()
export class BookingPoliciesService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly flights: Model<FlightBooking>,
    @InjectModel(HotelReservation.name)
    private readonly hotels: Model<HotelReservation>,
    @Inject(FLIGHT_INVENTORY) private readonly flightInventory: FlightInventory,
    @Inject(HOTEL_INVENTORY) private readonly hotelInventory: HotelInventory,
  ) {}

  /** The current terms (or, once accepted, the accepted ones); the owner only (ACC-11: 404 otherwise). */
  async show(
    user: AuthUser,
    type: BookingType,
    id: string,
  ): Promise<BookingPoliciesDto> {
    const booking = await this.load(user, type, id);
    if (booking.policiesAcceptedAt && booking.policySnapshot) {
      return toDto(type, booking, booking.policySnapshot);
    }
    const terms = await this.currentTerms(type, id);
    return toDto(type, booking, { ...terms, version: policiesVersion(terms) });
  }

  /**
   * Records the acceptance of `dto.version`, the terms the user was shown. Refused with 409 when the
   * terms changed since (show them again), when the hold is over (HOLD_EXPIRED), or when the booking is
   * no longer awaiting payment. Idempotent: a repeat keeps the first acceptance time.
   */
  async accept(
    user: AuthUser,
    type: BookingType,
    id: string,
    dto: AcceptPoliciesDto,
    now: Date = new Date(),
  ): Promise<BookingPoliciesDto> {
    const booking = await this.load(user, type, id);
    if (booking.policiesAcceptedAt && booking.policySnapshot) {
      return toDto(type, booking, booking.policySnapshot);
    }
    assertAwaitingPayment(booking, now);
    const terms = await this.currentTerms(type, id);
    const version = policiesVersion(terms);
    if (version !== dto.version) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        `The provider's policies changed after they were shown (now version ${version}). Review them again with GET /api/bookings/${type.toLowerCase()}/${id}/policies; nothing was accepted`,
      );
    }
    const snapshot: PolicySnapshot = { ...terms, version };
    const model = this.model(type);
    const res = await model
      .updateOne(
        {
          _id: booking._id,
          userId: booking.userId,
          status: BookingStatus.PendingPayment,
          holdExpiresAt: { $gt: now },
          policiesAcceptedAt: null,
        },
        { $set: { policySnapshot: snapshot, policiesAcceptedAt: now } },
      )
      .exec();
    if (res.modifiedCount === 1) {
      return toDto(
        type,
        { ...booking, policiesAcceptedAt: now, policySnapshot: snapshot },
        snapshot,
      );
    }
    // Another request accepted, or the booking moved, between the read and the write.
    const fresh = await this.load(user, type, id);
    if (fresh.policiesAcceptedAt && fresh.policySnapshot) {
      return toDto(type, fresh, fresh.policySnapshot);
    }
    assertAwaitingPayment(fresh, now);
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.CONFLICT,
      'The booking changed while the policies were being accepted. Try again',
    );
  }

  private model(type: BookingType): BookingModel {
    return type === BookingType.Flight ? this.flights : this.hotels;
  }

  private async load(
    user: AuthUser,
    type: BookingType,
    id: string,
  ): Promise<PolicyTarget> {
    const booking = Types.ObjectId.isValid(id)
      ? ((await this.model(type)
          .findById(id, {
            userId: 1,
            status: 1,
            holdExpiresAt: 1,
            policiesAcceptedAt: 1,
            policySnapshot: 1,
          })
          .lean()
          .exec()) as PolicyTarget | null)
      : null;
    // The owner only: anyone else, admins included, gets "not found" (ACC-11, OWASP API1).
    if (!booking || booking.userId.toHexString() !== user.id) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Booking not found',
      );
    }
    return booking;
  }

  /** The provider's terms now: each flight's airline, or the hotel. A provider gone is a 409. */
  private async currentTerms(
    type: BookingType,
    id: string,
  ): Promise<ProviderPolicies> {
    if (type === BookingType.Hotel) {
      const r = await this.hotels.findById(id, { hotelId: 1 }).lean().exec();
      const hotel = r
        ? await this.hotelInventory.getHotelPolicy(r.hotelId.toHexString())
        : null;
      if (!hotel) throw providerGone();
      return { hotel };
    }
    const b = await this.flights.findById(id, { segments: 1 }).lean().exec();
    const airlines = await Promise.all(
      (b?.segments ?? []).map((s) =>
        this.flightInventory.getAirlinePolicy(
          s.flightId.toHexString(),
          s.cabinId.toHexString(),
        ),
      ),
    );
    if (!airlines.length || airlines.some((a) => a === null)) {
      throw providerGone();
    }
    return { airlines: airlines.map((a) => a!) };
  }
}

function assertAwaitingPayment(
  booking: Pick<PolicyTarget, 'status' | 'holdExpiresAt'>,
  now: Date,
): void {
  const expired =
    booking.status === BookingStatus.Expired ||
    (booking.status === BookingStatus.PendingPayment &&
      booking.holdExpiresAt <= now);
  if (expired) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.HOLD_EXPIRED,
      'The 10-minute hold on this booking has expired; book again',
    );
  }
  if (booking.status !== BookingStatus.PendingPayment) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.INVALID_STATE_TRANSITION,
      `This booking is ${booking.status}; policies are accepted before payment only`,
    );
  }
}

function providerGone(): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.CONFLICT,
    "The provider of this booking no longer exists, so its policies can't be shown",
  );
}

function toDto(
  type: BookingType,
  b: PolicyTarget,
  snapshot: PolicySnapshot,
): BookingPoliciesDto {
  return {
    bookingType: type,
    bookingId: b._id.toHexString(),
    status: b.status,
    holdExpiresAt: b.holdExpiresAt,
    accepted: b.policiesAcceptedAt !== null,
    acceptedAt: b.policiesAcceptedAt,
    version: snapshot.version,
    ...(snapshot.airlines && { airlines: snapshot.airlines }),
    ...(snapshot.hotel && { hotel: snapshot.hotel }),
  };
}

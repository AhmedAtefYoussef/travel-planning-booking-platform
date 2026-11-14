import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
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

/** What PAY-02 reads from either booking collection, in one query. */
interface PolicyTarget {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  status: BookingStatus;
  holdExpiresAt: Date;
  policiesAcceptedAt: Date | null;
  policySnapshot: PolicySnapshot | null;
  /** Hotel reservations. */
  hotelId?: Types.ObjectId;
  /** Flight bookings. */
  segments?: { flightId: Types.ObjectId; cabinId: Types.ObjectId }[];
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

const PROJECTION: Record<string, 1> = {
  userId: 1,
  status: 1,
  holdExpiresAt: 1,
  policiesAcceptedAt: 1,
  policySnapshot: 1,
  hotelId: 1,
  'segments.flightId': 1,
  'segments.cabinId': 1,
};

/**
 * PAY-02: shows the provider's policies for one booking (airline: cancellation and baggage; hotel:
 * cancellation and check-in/check-out times) and records the user's acceptance with a timestamp and a
 * snapshot of exactly those terms. PAY-01 refuses payment until then (assertPayable). PAY-03 refunds
 * from the snapshot, so a later policy change never alters this booking's refund.
 *
 * An empty tier list is shown as it is defined (FLT-09, HTL-10): no refund on a user cancellation.
 */
@Injectable()
export class BookingPoliciesService {
  private readonly logger = new Logger(BookingPoliciesService.name);

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
    const accepted = acceptedSnapshot(booking);
    if (accepted) return toDto(type, booking, accepted);
    const terms = await this.currentTerms(type, booking);
    return toDto(type, booking, { ...terms, version: policiesVersion(terms) });
  }

  /**
   * Records the acceptance of `dto.version`, the terms the user was shown. Refused with 409
   * POLICIES_CHANGED when the terms changed since (show them again), HOLD_EXPIRED when the hold is over,
   * or INVALID_STATE_TRANSITION when the booking no longer awaits payment. Only an exact repeat (same
   * version) is idempotent and keeps the first acceptance time.
   */
  async accept(
    user: AuthUser,
    type: BookingType,
    id: string,
    dto: AcceptPoliciesDto,
    now: Date = new Date(),
  ): Promise<BookingPoliciesDto> {
    const booking = await this.load(user, type, id);
    const accepted = acceptedSnapshot(booking);
    if (accepted) return this.repeat(type, booking, accepted, dto.version);
    assertAwaitingPayment(booking, now);
    const terms = await this.currentTerms(type, booking);
    const version = policiesVersion(terms);
    if (version !== dto.version) throw policiesChanged(type, id, version);
    const snapshot: PolicySnapshot = { ...terms, version };
    const res = await this.model(type)
      .updateOne(
        {
          _id: booking._id,
          userId: booking.userId,
          status: BookingStatus.PendingPayment,
          holdExpiresAt: { $gt: now },
          // A timestamp without stored terms is a defect; accepting again repairs it.
          $or: [{ policiesAcceptedAt: null }, { policySnapshot: null }],
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
    const winner = acceptedSnapshot(fresh);
    if (winner) return this.repeat(type, fresh, winner, dto.version);
    assertAwaitingPayment(fresh, now);
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.CONFLICT,
      'The booking changed while the policies were being accepted. Try again',
    );
  }

  /** An exact repeat returns the stored acceptance; a different version was not what was accepted. */
  private repeat(
    type: BookingType,
    booking: PolicyTarget,
    snapshot: PolicySnapshot,
    version: string,
  ): BookingPoliciesDto {
    if (snapshot.version !== version) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.POLICIES_CHANGED,
        `Other terms (version ${snapshot.version}) were already accepted for this booking; they are the ones that apply`,
      );
    }
    return toDto(type, booking, snapshot);
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
          .findById(id, PROJECTION)
          .lean()
          .exec()) as PolicyTarget | null)
      : null;
    // The owner only: anyone else gets "not found", so ids cannot be probed (ACC-11, OWASP API1).
    if (!booking || booking.userId.toHexString() !== user.id) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Booking not found',
      );
    }
    if (booking.policiesAcceptedAt && !booking.policySnapshot) {
      this.logger.error(
        `${type} booking ${id} has policiesAcceptedAt but no stored policy terms; it must be accepted again`,
      );
    }
    return booking;
  }

  /** The provider's terms now: each flight's airline, or the hotel. A provider gone is logged and a 409. */
  private async currentTerms(
    type: BookingType,
    booking: PolicyTarget,
  ): Promise<ProviderPolicies> {
    const id = booking._id.toHexString();
    if (type === BookingType.Hotel) {
      const hotelId = booking.hotelId?.toHexString();
      const hotel = hotelId
        ? await this.hotelInventory.getHotelPolicy(hotelId)
        : null;
      if (!hotel) {
        throw this.providerGone(id, `hotel ${hotelId ?? '(none)'} not found`);
      }
      return { hotel };
    }
    const segments = booking.segments ?? [];
    if (!segments.length) {
      throw this.providerGone(id, 'the booking has no flights');
    }
    const airlines = [];
    for (const s of segments) {
      const policy = await this.flightInventory.getAirlinePolicy(
        s.flightId.toHexString(),
        s.cabinId.toHexString(),
      );
      if (!policy) {
        throw this.providerGone(
          id,
          `flight ${s.flightId.toHexString()}, its cabin ${s.cabinId.toHexString()} or its airline not found`,
        );
      }
      airlines.push(policy);
    }
    return { airlines };
  }

  private providerGone(bookingId: string, reason: string): AppException {
    this.logger.error(
      `Policies of booking ${bookingId} cannot be shown: ${reason}`,
    );
    return new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.CONFLICT,
      "The provider of this booking no longer exists, so its policies can't be shown",
    );
  }
}

/** The accepted terms, only when both the timestamp and the terms are stored. */
function acceptedSnapshot(b: PolicyTarget): PolicySnapshot | null {
  return b.policiesAcceptedAt && b.policySnapshot ? b.policySnapshot : null;
}

function policiesChanged(
  type: BookingType,
  id: string,
  version: string,
): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.POLICIES_CHANGED,
    `The provider's policies changed after they were shown (now version ${version}). Review them again with GET /api/bookings/${type.toLowerCase()}/${id}/policies; nothing was accepted`,
  );
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

function toDto(
  type: BookingType,
  b: PolicyTarget,
  snapshot: PolicySnapshot,
): BookingPoliciesDto {
  const accepted = acceptedSnapshot(b) !== null;
  return {
    bookingType: type,
    bookingId: b._id.toHexString(),
    status: b.status,
    holdExpiresAt: b.holdExpiresAt,
    accepted,
    acceptedAt: accepted ? b.policiesAcceptedAt : null,
    version: snapshot.version,
    ...(snapshot.airlines && { airlines: snapshot.airlines }),
    ...(snapshot.hotel && { hotel: snapshot.hotel }),
  };
}

import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { assertOwner } from '../../common/auth/access';
import { AuthUser, Role } from '../../common/auth/auth.types';
import {
  ACTIVE_PROVIDER_FILTER,
  BookingStatus,
  BookingType,
  HOLD_DURATION_MS,
  type BookingPolicies,
  type PayableBooking,
  type PayableSnapshot,
} from '../../common/contracts';
import {
  AppException,
  ValidationFailedException,
  type FieldError,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  eachNight,
  lenientLocalToUtc,
  parseIsoDate,
  utcToLocalIso,
} from '../../common/utils/dates';
import { multiplyMinor, sumMinor } from '../../common/utils/money';
import type { EnvironmentVariables } from '../../config/env.validation';
import { expireHeldReservation } from './expire-hold';
import {
  Hotel,
  Room,
  RoomNight,
  RoomNightState,
  type AvailabilityRangeDoc,
} from '../hotels';
import {
  MAX_NIGHTS,
  type CreateHotelHoldDto,
  type HotelReservationDto,
} from './dto/hotel-booking.dto';
import {
  HotelReservation,
  type HotelReservationDocument,
} from './schemas/hotel-reservation.schema';

/** Used when the hotel has not set its check-in/out time yet (HTL-09). */
export const DEFAULT_CHECK_IN_TIME = '14:00';
export const DEFAULT_CHECK_OUT_TIME = '12:00';

/** Unambiguous characters for references (no 0/O, 1/I/L). */
const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** H + 7 random characters: about 34 bits, unique index as the final guarantee (HTL-17). */
export function newHotelReference(): string {
  let ref = 'H';
  for (let i = 0; i < 7; i++) {
    ref += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }
  return ref;
}

/** The requested nights a room's bookable ranges do not cover (HTL-04: `to` is exclusive). */
export function nightsOutside(
  availability: readonly Pick<AvailabilityRangeDoc, 'from' | 'to'>[],
  nights: readonly string[],
): string[] {
  return nights.filter(
    (night) => !availability.some((r) => r.from <= night && night < r.to),
  );
}

const notFound = (what: string) =>
  new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    `${what} not found`,
  );

const conflict = (code: ErrorCode, message: string, field?: string) =>
  new AppException(
    HttpStatus.CONFLICT,
    code,
    message,
    field ? [{ field, message }] : undefined,
  );

type LeanHotel = Hotel & { _id: Types.ObjectId };
type LeanRoom = Room & { _id: Types.ObjectId };

interface StayPlan {
  hotel: LeanHotel;
  checkIn: string;
  checkOut: string;
  nights: string[];
  checkInTime: string;
  checkOutTime: string;
  checkInUtc: Date;
  checkOutUtc: Date;
  rooms: { room: LeanRoom; adults: number; childrenAges: number[] }[];
}

/**
 * Hotel reservations (HTL-16 booking, HTL-18 hold, HTL-17 confirmation, GEN-11 lifecycle), also
 * exposed to payments as HOTEL_PAYABLE_BOOKING.
 *
 * The hold validates everything first and prices the stay on the server. Then ONE transaction marks
 * every room as reserved (re-checking it is still active, at the same price and bookable on every
 * night), inserts one HELD room_nights document per room per night and creates the reservation.
 * The unique {roomId, date} index (ADR-0002) makes MongoDB refuse a night that is already held,
 * booked or blocked, so the whole transaction aborts and nothing is held: concurrent requests can
 * never double book a room.
 */
@Injectable()
export class HotelBookingsService implements PayableBooking {
  constructor(
    @InjectModel(HotelReservation.name)
    private readonly reservations: Model<HotelReservation>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomNight.name) private readonly nights: Model<RoomNight>,
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** POST /api/hotel-bookings (HTL-16, HTL-18). */
  async hold(
    user: AuthUser,
    dto: CreateHotelHoldDto,
    now: Date = new Date(),
  ): Promise<HotelReservationDto> {
    const plan = await this.plan(dto, now);
    await this.releaseExpiredHolds(plan, now);
    const holdExpiresAt = new Date(now.getTime() + HOLD_DURATION_MS);
    let reservation: HotelReservationDocument;
    try {
      reservation = await this.connection.transaction(async (session) => {
        const hotel = await this.hotels
          .findOne({ _id: plan.hotel._id, ...ACTIVE_PROVIDER_FILTER })
          .session(session)
          .lean()
          .exec();
        if (!hotel) {
          throw conflict(
            ErrorCode.CONFLICT,
            `${plan.hotel.name} can no longer be booked: it is not active`,
          );
        }
        for (const [i, planned] of plan.rooms.entries()) {
          await this.reserveRoom(i, planned.room, plan.nights, session);
        }
        const reservationId = new Types.ObjectId();
        await this.nights.insertMany(
          plan.rooms.flatMap(({ room }) =>
            plan.nights.map((date) => ({
              roomId: room._id,
              hotelId: plan.hotel._id,
              date,
              state: RoomNightState.Held,
              reservationId,
            })),
          ),
          { session, ordered: true },
        );
        const roomSnapshots = plan.rooms.map(
          ({ room, adults, childrenAges }) => ({
            roomId: room._id,
            number: room.number,
            type: room.type,
            beds: room.beds,
            maxOccupancy: room.maxOccupancy,
            adults,
            childrenAges,
            nightlyPriceMinor: room.priceMinor,
            subtotalMinor: multiplyMinor(room.priceMinor, plan.nights.length),
          }),
        );
        const [created] = await this.reservations.create(
          [
            {
              _id: reservationId,
              userId: new Types.ObjectId(user.id),
              status: BookingStatus.PendingPayment,
              hotelId: plan.hotel._id,
              hotelName: plan.hotel.name,
              hotelAddress: plan.hotel.address,
              cityId: plan.hotel.cityId,
              countryCode: plan.hotel.countryCode,
              timeZone: plan.hotel.timeZone,
              checkIn: plan.checkIn,
              checkOut: plan.checkOut,
              nights: plan.nights.length,
              checkInTime: plan.checkInTime,
              checkOutTime: plan.checkOutTime,
              checkInUtc: plan.checkInUtc,
              checkOutUtc: plan.checkOutUtc,
              rooms: roomSnapshots,
              cancellationTiers: (hotel.policy?.cancellationTiers ?? []).map(
                (t) => ({
                  daysBefore: t.daysBefore,
                  refundPercent: t.refundPercent,
                }),
              ),
              totalMinor: sumMinor(roomSnapshots.map((r) => r.subtotalMinor)),
              currency: this.platformCurrency,
              holdExpiresAt,
            },
          ],
          { session },
        );
        return created;
      });
    } catch (e) {
      if ((e as { code?: unknown }).code === 11000) {
        throw await this.takenNightsConflict(plan);
      }
      throw e;
    }
    return toHotelReservationDto(reservation);
  }

  /** GET /api/hotel-bookings/:id: the owner, or an admin (ACC-11, ACC-17). */
  async findForUser(user: AuthUser, id: string): Promise<HotelReservationDto> {
    const reservation = await this.load(id);
    assertOwner(user, reservation.userId, { bypassRoles: [Role.Admin] });
    return toHotelReservationDto(reservation);
  }

  // ------------------------------------------------------------------------------------------------
  // HOTEL_PAYABLE_BOOKING (PAY-01, PAY-02, HTL-17)
  // ------------------------------------------------------------------------------------------------

  async getPayable(
    bookingId: string,
    userId: string,
  ): Promise<PayableSnapshot> {
    const r = await this.loadOwned(bookingId, userId);
    return {
      bookingType: BookingType.Hotel,
      bookingId: r.id as string,
      userId: r.userId.toHexString(),
      status: r.status,
      amountMinor: r.totalMinor,
      currency: r.currency,
      holdExpiresAt: r.holdExpiresAt,
      policiesAcceptedAt: r.policiesAcceptedAt,
      reference: r.reference ?? null,
    };
  }

  /** PAY-02: the hotel's cancellation tiers and check-in/out times, as snapshotted at hold time. */
  async getPolicies(
    bookingId: string,
    userId: string,
  ): Promise<BookingPolicies> {
    return toHotelPolicies(await this.loadOwned(bookingId, userId));
  }

  /** PAY-02: stores the acceptance once, only while unpaid and the hold is running. */
  async acceptPolicies(
    bookingId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<BookingPolicies> {
    const reservation = await this.loadOwned(bookingId, userId);
    assertAcceptable(reservation, now);
    if (reservation.policiesAcceptedAt) return toHotelPolicies(reservation);
    const updated = await this.reservations
      .findOneAndUpdate(
        {
          _id: reservation._id,
          status: BookingStatus.PendingPayment,
          holdExpiresAt: { $gt: now },
          policiesAcceptedAt: null,
        },
        { $set: { policiesAcceptedAt: now } },
        { new: true },
      )
      .exec();
    if (updated) return toHotelPolicies(updated);
    // Matched nothing: a parallel request accepted first (fine), or the hold ended or the status
    // changed in between (never answer 200 without a stored acceptance).
    const current = await this.load(bookingId);
    if (!current.policiesAcceptedAt) {
      assertAcceptable(current, now);
      throw conflict(
        ErrorCode.CONFLICT,
        'The policies could not be accepted; please try again',
      );
    }
    return toHotelPolicies(current);
  }

  /**
   * PENDING_PAYMENT -> CONFIRMED (HTL-17), only while the hold is still running, and every HELD night
   * becomes BOOKED with the new reference in the same transaction. Idempotent for a replayed webhook
   * of the same payment. If the reference collides (very unlikely), the unique index aborts the
   * transaction and Stripe's retry draws another one.
   */
  async markConfirmed(
    bookingId: string,
    input: { paymentId: string },
    session?: ClientSession,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(input.paymentId)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'paymentId must be a 24-character hexadecimal id',
      );
    }
    if (!Types.ObjectId.isValid(bookingId)) throw notFound('Reservation');
    const paymentId = new Types.ObjectId(input.paymentId);
    const run = (s: ClientSession) => this.confirm(bookingId, paymentId, s);
    if (session) return run(session);
    return this.connection.transaction(run);
  }

  /** Keeps the reservation PENDING_PAYMENT so the user can retry until the hold ends (PAY-01). */
  async markPaymentFailed(
    bookingId: string,
    input: { paymentId: string; reason: string },
    session?: ClientSession,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(bookingId)) return;
    await this.reservations
      .updateOne(
        { _id: bookingId, status: BookingStatus.PendingPayment },
        { $set: { lastPaymentError: input.reason.slice(0, 500) } },
        { session },
      )
      .exec();
  }

  // ------------------------------------------------------------------------------------------------

  private async confirm(
    bookingId: string,
    paymentId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    const now = new Date();
    const reference = newHotelReference();
    const updated = await this.reservations
      .findOneAndUpdate(
        {
          _id: bookingId,
          status: BookingStatus.PendingPayment,
          holdExpiresAt: { $gt: now },
        },
        {
          $set: {
            status: BookingStatus.Confirmed,
            paymentId,
            reference,
            confirmedAt: now,
            lastPaymentError: null,
          },
        },
        { new: true, session },
      )
      .exec();
    if (updated) {
      const expected = updated.rooms.length * updated.nights;
      const res = await this.nights
        .updateMany(
          { reservationId: updated._id, state: RoomNightState.Held },
          { $set: { state: RoomNightState.Booked, reference } },
          { session },
        )
        .exec();
      if (res.modifiedCount !== expected) {
        // Never confirm a reservation whose rooms are not all held: abort, so the payment is refunded.
        throw new Error(
          `Reservation ${bookingId} should hold ${expected} night(s) but ${res.modifiedCount} were found`,
        );
      }
      return;
    }

    const current = await this.reservations
      .findById(bookingId)
      .session(session)
      .exec();
    if (!current) throw notFound('Reservation');
    if (
      (current.status === BookingStatus.Confirmed ||
        current.status === BookingStatus.Completed) &&
      current.paymentId?.equals(paymentId)
    ) {
      return;
    }
    if (current.status === BookingStatus.PendingPayment) {
      throw conflict(
        ErrorCode.HOLD_EXPIRED,
        'The 10-minute hold has expired, so this reservation can no longer be confirmed',
      );
    }
    throw conflict(
      ErrorCode.INVALID_STATE_TRANSITION,
      `A ${current.status} reservation cannot be confirmed (GEN-11)`,
    );
  }

  /**
   * Inside the hold transaction: the room must still belong to the hotel, be active, cost the price
   * the stay was priced at and be bookable on every night. Marking it `everReserved` here also makes a
   * concurrent delete of the room conflict with the hold (HTL-06).
   */
  private async reserveRoom(
    index: number,
    planned: LeanRoom,
    nights: string[],
    session: ClientSession,
  ): Promise<void> {
    const field = `rooms[${index}].roomId`;
    const room = await this.rooms
      .findOneAndUpdate(
        { _id: planned._id, hotelId: planned.hotelId, isActive: true },
        { $set: { everReserved: true } },
        { new: true, session },
      )
      .lean()
      .exec();
    if (!room) {
      throw conflict(
        ErrorCode.CONFLICT,
        `Room ${planned.number} can no longer be booked`,
        field,
      );
    }
    if (room.priceMinor !== planned.priceMinor) {
      throw conflict(
        ErrorCode.CONFLICT,
        `The price of room ${planned.number} changed while you were booking; look at the rooms again`,
        field,
      );
    }
    const outside = nightsOutside(room.availability, nights);
    if (outside.length) {
      throw conflict(
        ErrorCode.INSUFFICIENT_INVENTORY,
        `Room ${planned.number} is not bookable on ${outside.join(', ')}`,
        field,
      );
    }
  }

  /**
   * HTL-18 rejects only UNEXPIRED holds. A hold that has expired but was not swept yet still has its
   * HELD nights, so expire those reservations (and delete their nights) first, exactly as the sweep
   * would. Conditional on status and holdExpiresAt, so a reservation paid in time is never touched.
   */
  private async releaseExpiredHolds(plan: StayPlan, now: Date): Promise<void> {
    const held = await this.nights
      .find(
        {
          roomId: { $in: plan.rooms.map((r) => r.room._id) },
          date: { $in: plan.nights },
          state: RoomNightState.Held,
        },
        { reservationId: 1 },
      )
      .lean()
      .exec();
    const ids = [...new Set(held.map((n) => String(n.reservationId)))];
    if (!ids.length) return;
    const stale = await this.reservations
      .find(
        {
          _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
          status: BookingStatus.PendingPayment,
          holdExpiresAt: { $lte: now },
        },
        { _id: 1 },
      )
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    for (const { _id } of stale) {
      // A failure here only means the night still looks taken; the hold then answers 409.
      await expireHeldReservation(
        {
          reservations: this.reservations,
          nights: this.nights,
          connection: this.connection,
        },
        _id,
        now,
      ).catch(() => false);
    }
  }

  /** After a duplicate {roomId, date}: names the rooms and nights that are already taken. */
  private async takenNightsConflict(plan: StayPlan): Promise<AppException> {
    const taken = await this.nights
      .find(
        {
          roomId: { $in: plan.rooms.map((r) => r.room._id) },
          date: { $in: plan.nights },
        },
        { roomId: 1, date: 1 },
      )
      .sort({ date: 1 })
      .lean()
      .exec();
    const errors: FieldError[] = [];
    for (const [i, { room }] of plan.rooms.entries()) {
      const dates = taken
        .filter((n) => n.roomId.equals(room._id))
        .map((n) => n.date);
      if (dates.length) {
        errors.push({
          field: `rooms[${i}].roomId`,
          message: `Room ${room.number} is not free on ${dates.join(', ')}`,
        });
      }
    }
    return new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.INSUFFICIENT_INVENTORY,
      errors.length
        ? 'Some of these rooms are no longer free for your dates; nothing was held'
        : 'A room was taken while you were booking; nothing was held, please try again',
      errors.length ? errors : undefined,
    );
  }

  /**
   * Every rule that does not need the hold, reported together (GEN-02): dates (check-out after
   * check-in, check-in not in the past in the hotel's zone, at most MAX_NIGHTS), different rooms of
   * this hotel, at least one guest per room and one adult per reservation, no room over its maximum
   * occupancy (HTL-16); then 409 when the hotel or a room cannot be booked for these nights.
   */
  private async plan(dto: CreateHotelHoldDto, now: Date): Promise<StayPlan> {
    const hotel = await this.hotels
      .findById(dto.hotelId)
      .lean<LeanHotel>()
      .exec();
    if (!hotel) throw notFound('Hotel');
    if (!hotel.isActive) {
      throw conflict(
        ErrorCode.CONFLICT,
        `${hotel.name} can no longer be booked: it is not active`,
      );
    }

    const errors: FieldError[] = [];
    const validDate = (field: 'checkIn' | 'checkOut') => {
      try {
        parseIsoDate(dto[field]);
        return true;
      } catch {
        errors.push({ field, message: `${field} is not a real calendar date` });
        return false;
      }
    };
    const datesOk = [validDate('checkIn'), validDate('checkOut')].every(
      Boolean,
    );
    let nights: string[] = [];
    if (datesOk) {
      const today = utcToLocalIso(now, hotel.timeZone).slice(0, 10);
      if (dto.checkIn < today) {
        errors.push({
          field: 'checkIn',
          message: `checkIn cannot be in the past (today is ${today} at the hotel)`,
        });
      }
      if (dto.checkOut <= dto.checkIn) {
        errors.push({
          field: 'checkOut',
          message: 'checkOut must be after checkIn',
        });
      } else {
        nights = eachNight(dto.checkIn, dto.checkOut);
        if (nights.length > MAX_NIGHTS) {
          errors.push({
            field: 'checkOut',
            message: `A reservation can be at most ${MAX_NIGHTS} nights`,
          });
        }
      }
    }

    const ids = dto.rooms.map((r) => r.roomId);
    const loaded = await this.rooms
      .find({ _id: { $in: [...new Set(ids)] } })
      .lean<LeanRoom[]>()
      .exec();
    const byId = new Map(loaded.map((r) => [r._id.toHexString(), r]));
    const seen = new Set<string>();
    let adults = 0;
    const planned: StayPlan['rooms'] = [];
    for (const [i, wanted] of dto.rooms.entries()) {
      const childrenAges = wanted.childrenAges ?? [];
      adults += wanted.adults;
      if (seen.has(wanted.roomId)) {
        errors.push({
          field: `rooms[${i}].roomId`,
          message: 'The same room is listed twice',
        });
        continue;
      }
      seen.add(wanted.roomId);
      const room = byId.get(wanted.roomId);
      if (!room || !room.hotelId.equals(hotel._id)) {
        errors.push({
          field: `rooms[${i}].roomId`,
          message: `This is not a room of ${hotel.name}`,
        });
        continue;
      }
      const guests = wanted.adults + childrenAges.length;
      if (guests < 1) {
        errors.push({
          field: `rooms[${i}]`,
          message: `Room ${room.number} needs at least one guest`,
        });
      } else if (guests > room.maxOccupancy) {
        errors.push({
          field: `rooms[${i}]`,
          message: `Room ${room.number} sleeps at most ${room.maxOccupancy}; ${guests} guests were assigned`,
        });
      }
      planned.push({ room, adults: wanted.adults, childrenAges });
    }
    if (adults < 1) {
      errors.push({
        field: 'rooms',
        message: 'A reservation needs at least one adult',
      });
    }
    if (errors.length) throw new ValidationFailedException(errors);

    for (const [i, { room }] of planned.entries()) {
      const field = `rooms[${i}].roomId`;
      if (!room.isActive) {
        throw conflict(
          ErrorCode.CONFLICT,
          `Room ${room.number} can no longer be booked`,
          field,
        );
      }
      const outside = nightsOutside(room.availability, nights);
      if (outside.length) {
        throw conflict(
          ErrorCode.INSUFFICIENT_INVENTORY,
          `Room ${room.number} is not bookable on ${outside.join(', ')}`,
          field,
        );
      }
    }

    const checkInTime = hotel.policy?.checkInTime ?? DEFAULT_CHECK_IN_TIME;
    const checkOutTime = hotel.policy?.checkOutTime ?? DEFAULT_CHECK_OUT_TIME;
    return {
      hotel,
      checkIn: dto.checkIn,
      checkOut: dto.checkOut,
      nights,
      checkInTime,
      checkOutTime,
      checkInUtc: lenientLocalToUtc(
        `${dto.checkIn}T${checkInTime}`,
        hotel.timeZone,
      ),
      checkOutUtc: lenientLocalToUtc(
        `${dto.checkOut}T${checkOutTime}`,
        hotel.timeZone,
      ),
      rooms: planned,
    };
  }

  /** 404 when missing, 403 when `userId` is not the owner (ACC-11). */
  private async loadOwned(
    bookingId: string,
    userId: string,
  ): Promise<HotelReservationDocument> {
    const reservation = await this.load(bookingId);
    if (reservation.userId.toHexString() !== userId) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'You can only access your own reservations',
      );
    }
    return reservation;
  }

  async load(id: string): Promise<HotelReservationDocument> {
    const reservation = Types.ObjectId.isValid(id)
      ? await this.reservations.findById(id).exec()
      : null;
    if (!reservation) throw notFound('Reservation');
    return reservation;
  }

  private get platformCurrency(): string {
    return this.config.get('PLATFORM_CURRENCY', { infer: true }).toUpperCase();
  }
}

const stayTime = (date: string, time: string, utc: Date, zone: string) => ({
  date,
  time,
  utc,
  local: utcToLocalIso(utc, zone),
});

export function toHotelReservationDto(
  r: HotelReservationDocument,
): HotelReservationDto {
  return {
    id: r.id as string,
    reference: r.reference ?? null,
    status: r.status,
    holdExpiresAt: r.holdExpiresAt,
    hotelId: r.hotelId.toHexString(),
    hotelName: r.hotelName,
    hotelAddress: r.hotelAddress,
    timeZone: r.timeZone,
    checkIn: stayTime(r.checkIn, r.checkInTime, r.checkInUtc, r.timeZone),
    checkOut: stayTime(r.checkOut, r.checkOutTime, r.checkOutUtc, r.timeZone),
    nights: r.nights,
    rooms: r.rooms.map((room) => ({
      roomId: room.roomId.toHexString(),
      number: room.number,
      type: room.type,
      beds: room.beds,
      maxOccupancy: room.maxOccupancy,
      adults: room.adults,
      childrenAges: [...room.childrenAges],
      nightlyPriceMinor: room.nightlyPriceMinor,
      subtotalMinor: room.subtotalMinor,
    })),
    cancellationTiers: sortedTiers(r),
    totalMinor: r.totalMinor,
    currency: r.currency,
    policiesAcceptedAt: r.policiesAcceptedAt ?? null,
    lastPaymentError: r.lastPaymentError ?? null,
    refundId: r.refundId ? r.refundId.toHexString() : null,
    confirmedAt: r.confirmedAt ?? null,
    expiredAt: r.expiredAt ?? null,
    completedAt: r.completedAt ?? null,
    cancelledAt: r.cancelledAt ?? null,
    createdAt: r.createdAt,
  };
}

const sortedTiers = (r: HotelReservationDocument) =>
  r.cancellationTiers
    .map((t) => ({ daysBefore: t.daysBefore, refundPercent: t.refundPercent }))
    .sort((a, b) => b.daysBefore - a.daysBefore);

/** PAY-02 view of a reservation's snapshot: the hotel's tiers and check-in/out times. */
export function toHotelPolicies(r: HotelReservationDocument): BookingPolicies {
  return {
    bookingType: BookingType.Hotel,
    bookingId: r.id as string,
    status: r.status,
    holdExpiresAt: r.holdExpiresAt,
    cancellationPolicyOf: r.hotelName,
    cancellationTiers: sortedTiers(r),
    baggage: null,
    checkInOut: { checkInTime: r.checkInTime, checkOutTime: r.checkOutTime },
    policiesAcceptedAt: r.policiesAcceptedAt ?? null,
  };
}

/** PAY-02: policies can be accepted only for an unpaid reservation whose hold is still running. */
function assertAcceptable(r: HotelReservationDocument, now: Date): void {
  if (r.status !== BookingStatus.PendingPayment) {
    throw conflict(
      ErrorCode.INVALID_STATE_TRANSITION,
      `Policies can only be accepted for a reservation awaiting payment; this one is ${r.status}`,
    );
  }
  if (r.holdExpiresAt.getTime() <= now.getTime()) {
    throw conflict(
      ErrorCode.HOLD_EXPIRED,
      'The 10-minute hold has expired; choose the rooms again',
    );
  }
}

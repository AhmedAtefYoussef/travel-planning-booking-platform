import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { assertOwner } from '../../common/auth/access';
import { AuthUser, Role } from '../../common/auth/auth.types';
import {
  BookingStatus,
  BookingType,
  HOLD_DURATION_MS,
  HOTEL_INVENTORY,
  transitionBooking,
  type BookableStay,
  type HotelInventory,
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
  generateBookingReference,
  isReferenceCollision,
} from '../../common/utils/booking-reference';
import { eachNight, localDayRangeUtc } from '../../common/utils/dates';
import { multiplyMinor, sumMinor } from '../../common/utils/money';
import type { EnvironmentVariables } from '../../config/env.validation';
import { todayIn } from '../hotels';
import type {
  HotelBookingRequestDto,
  HotelReservationDto,
} from './dto/hotel-booking.dto';
import { assertUnpaidHoldsBelowCap, EXPIRY_BATCH } from './hold-limit';
import { HoldGuard } from './schemas/hold-guard.schema';
import {
  HotelReservation,
  type HotelReservationDocument,
} from './schemas/hotel-reservation.schema';

const REFERENCE_ATTEMPTS = 3;

/** Everything a hold needs, validated once. */
interface Plan {
  stay: BookableStay & { timeZone: string };
  nights: string[];
}

/**
 * Hotel reservations: HTL-16 multi-room booking with guests per room, HTL-18 all-or-nothing 10-minute
 * hold and expiry, and the HOTEL_PAYABLE_BOOKING contract that PAY-01 confirms through (HTL-17 books
 * the nights).
 *
 * Nights are taken through HOTEL_INVENTORY inside ONE transaction with the reservation insert, so
 * every room is held or none is (ADR-0002).
 */
@Injectable()
export class HotelBookingsService implements PayableBooking {
  private readonly logger = new Logger(HotelBookingsService.name);

  constructor(
    @InjectModel(HotelReservation.name)
    private readonly reservations: Model<HotelReservation>,
    @InjectModel(HoldGuard.name)
    private readonly guards: Model<HoldGuard>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(HOTEL_INVENTORY) private readonly inventory: HotelInventory,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** HTL-16/HTL-18: holds every room for 10 minutes as one PENDING_PAYMENT reservation, or nothing. */
  async hold(
    user: AuthUser,
    dto: HotelBookingRequestDto,
    now: Date = new Date(),
  ): Promise<HotelReservationDto> {
    // Ids are compared as text below; IsMongoId also accepts upper-case hex.
    dto = {
      ...dto,
      hotelId: dto.hotelId.toLowerCase(),
      rooms: dto.rooms.map((r) => ({ ...r, roomId: r.roomId.toLowerCase() })),
    };
    const { stay, nights } = await this.plan(dto, now);
    const roomIds = dto.rooms.map((r) => r.roomId);
    const session = await this.connection.startSession();
    try {
      let created: HotelReservationDocument | undefined;
      await session.withTransaction(async () => {
        // Re-read the clock on every attempt: a transaction retry must not judge holds by a stale time,
        // and the 10 minutes start when the nights are taken.
        const at = new Date(Math.max(now.getTime(), Date.now()));
        await assertUnpaidHoldsBelowCap(
          this.guards,
          this.reservations,
          user.id,
          at,
          session,
          'hotel reservations',
        );
        await this.expireStaleHolders(roomIds, nights, at, session);
        const holdExpiresAt = new Date(at.getTime() + HOLD_DURATION_MS);
        const reservationId = new Types.ObjectId();
        const held = await this.inventory.holdNights(
          {
            hotelId: stay.hotelId,
            roomIds,
            nights,
            reservationId: reservationId.toHexString(),
            expiresAt: holdExpiresAt,
          },
          session,
        );
        // HTL-05/HTL-16: the price is the one read inside this transaction, stored on the reservation.
        const rooms = dto.rooms.map((r, i) => ({
          roomId: new Types.ObjectId(r.roomId),
          roomNumber: held[i].number,
          adults: r.adults,
          childrenAges: r.childrenAges ?? [],
          nightlyPriceMinor: held[i].priceMinor,
          subtotalMinor: multiplyMinor(held[i].priceMinor, nights.length),
        }));
        this.assertOccupancy(dto, held);
        [created] = await this.reservations.create(
          [
            {
              _id: reservationId,
              userId: new Types.ObjectId(user.id),
              hotelId: new Types.ObjectId(stay.hotelId),
              hotelName: stay.hotelName,
              checkIn: dto.checkIn,
              checkOut: dto.checkOut,
              nights: nights.length,
              timeZone: stay.timeZone,
              rooms,
              totalMinor: sumMinor(rooms.map((r) => r.subtotalMinor)),
              currency: this.config.get('PLATFORM_CURRENCY', { infer: true }),
              status: BookingStatus.PendingPayment,
              holdExpiresAt,
              startsAt: localDayRangeUtc(dto.checkIn, stay.timeZone).start,
              endsAt: localDayRangeUtc(dto.checkOut, stay.timeZone).end,
            },
          ],
          { session },
        );
      });
      return toDto(created!);
    } finally {
      await session.endSession();
    }
  }

  /** ACC-11: the owner sees their reservation; an admin sees any; anyone else gets 404. */
  async findOne(user: AuthUser, id: string): Promise<HotelReservationDto> {
    const reservation = Types.ObjectId.isValid(id)
      ? await this.reservations.findById(id).exec()
      : null;
    if (!reservation) throw notFound();
    assertOwner(user, reservation.userId, {
      bypassRoles: [Role.Admin],
      notFound: true,
    });
    return toDto(reservation);
  }

  /**
   * HTL-18, GEN-11: moves every hold past its 10 minutes to EXPIRED and releases its nights, each in its
   * own transaction (status-conditioned, so of two concurrent runs only one releases). One failing
   * reservation is logged and does not stop the others.
   */
  async expireHolds(now: Date = new Date()): Promise<number> {
    const due = await this.reservations
      .find(
        { status: BookingStatus.PendingPayment, holdExpiresAt: { $lte: now } },
        { _id: 1 },
      )
      .sort({ holdExpiresAt: 1 })
      .limit(EXPIRY_BATCH)
      .lean()
      .exec();
    let expired = 0;
    for (const { _id } of due) {
      const id = _id.toHexString();
      const session = await this.connection.startSession();
      try {
        let moved = false;
        await session.withTransaction(async () => {
          moved = await this.expireOne(id, now, session);
        });
        if (moved) expired += 1;
      } catch (e) {
        this.logger.error(
          `Expiring hotel hold ${id} failed; it stays held until the next run`,
          e instanceof Error ? e.stack : String(e),
        );
      } finally {
        await session.endSession();
      }
    }
    if (due.length === EXPIRY_BATCH) {
      this.logger.warn(
        `Hotel hold expiry backlog: a full batch of ${EXPIRY_BATCH} was due; more holds are waiting`,
      );
    }
    if (expired) this.logger.log(`Expired ${expired} hotel hold(s)`);
    return expired;
  }

  /* ----------------------------- HOTEL_PAYABLE_BOOKING (PAY-01) ----------------------------- */

  async getPayable(
    bookingId: string,
    userId: string,
  ): Promise<PayableSnapshot> {
    const r = Types.ObjectId.isValid(bookingId)
      ? await this.reservations.findById(bookingId).lean().exec()
      : null;
    // Someone else's reservation is "not found", never "forbidden": no existence leak (ACC-11, API1).
    if (!r || r.userId.toHexString() !== userId) throw notFound();
    return {
      bookingType: BookingType.Hotel,
      bookingId,
      userId,
      status: r.status,
      amountMinor: r.totalMinor,
      currency: r.currency,
      holdExpiresAt: r.holdExpiresAt,
      policiesAcceptedAt: r.policiesAcceptedAt,
      policiesVersion: r.policySnapshot?.version ?? null,
      reference: r.reference,
    };
  }

  /**
   * HTL-17: PENDING_PAYMENT -> CONFIRMED with a fresh HT- reference, and every held night becomes
   * BOOKED, in one transaction (the caller's when `session` is given). Only while the hold has not
   * expired; idempotent for a replayed webhook. Throws HOLD_EXPIRED / INVALID_STATE_TRANSITION otherwise.
   *
   * A reference collision (about 1 in 10^12) aborts a transaction. Without a session it is retried here
   * with a new reference. Inside the caller's session it is rethrown unchanged (code 11000 on the
   * `reference` index): withTransaction does NOT retry it, so the caller (PAY-01) must run its whole
   * transaction again, which draws a new reference. See isReferenceCollision.
   */
  async markConfirmed(
    bookingId: string,
    input: { paymentId: string },
    session?: ClientSession,
    now: Date = new Date(),
  ): Promise<void> {
    if (!Types.ObjectId.isValid(input.paymentId)) {
      throw new Error(
        `markConfirmed for hotel reservation ${bookingId}: "${input.paymentId}" is not a payment id`,
      );
    }
    let moved = false;
    if (session) {
      moved = await this.confirmIn(bookingId, input.paymentId, now, session);
    } else {
      for (let attempt = 1; attempt <= REFERENCE_ATTEMPTS; attempt++) {
        const own = await this.connection.startSession();
        try {
          await own.withTransaction(async () => {
            moved = await this.confirmIn(bookingId, input.paymentId, now, own);
          });
          break;
        } catch (e) {
          if (!isReferenceCollision(e)) throw e;
          if (attempt === REFERENCE_ATTEMPTS) {
            throw new Error(
              `Could not allocate a unique booking reference for ${bookingId}`,
              { cause: e },
            );
          }
        } finally {
          await own.endSession();
        }
      }
    }
    if (moved) return;
    const current = await this.reservations
      .findById(bookingId, null, { session })
      .lean()
      .exec();
    if (!current) throw notFound();
    if (
      current.status === BookingStatus.Confirmed &&
      current.paymentId?.toHexString() === input.paymentId
    ) {
      return; // replayed webhook
    }
    const holdOver =
      current.status === BookingStatus.Expired ||
      (current.status === BookingStatus.PendingPayment &&
        current.holdExpiresAt <= now);
    throw new AppException(
      HttpStatus.CONFLICT,
      holdOver ? ErrorCode.HOLD_EXPIRED : ErrorCode.INVALID_STATE_TRANSITION,
      holdOver
        ? 'The 10-minute hold on this reservation has expired'
        : `This reservation is ${current.status} and cannot be confirmed`,
    );
  }

  /** The reservation stays PENDING_PAYMENT so the user can retry until the hold expires (PAY-01). */
  async markPaymentFailed(
    bookingId: string,
    input: { paymentId: string; reason: string },
  ): Promise<void> {
    const r = Types.ObjectId.isValid(bookingId)
      ? await this.reservations.findById(bookingId, { status: 1 }).lean().exec()
      : null;
    if (!r) throw notFound();
    this.logger.warn(
      `Payment ${input.paymentId} for hotel reservation ${bookingId} (${r.status}) failed: ${input.reason}`,
    );
  }

  /* ------------------------------------------ helpers ------------------------------------------ */

  private async confirmIn(
    bookingId: string,
    paymentId: string,
    now: Date,
    session: ClientSession,
  ): Promise<boolean> {
    const reference = generateBookingReference('HOTEL');
    const moved = await transitionBooking(
      this.reservations,
      bookingId,
      BookingStatus.PendingPayment,
      BookingStatus.Confirmed,
      {
        where: { holdExpiresAt: { $gt: now } },
        set: {
          paymentId: new Types.ObjectId(paymentId),
          reference,
          confirmedAt: now,
        },
        session,
      },
    );
    if (!moved) return false;
    const expected = await this.expectedNights(bookingId, session);
    const booked = await this.inventory.bookNights(
      bookingId,
      reference,
      session,
    );
    if (booked !== expected) {
      // A night that is not BOOKED could be sold again: refuse the whole confirmation (rolls back).
      this.logger.error(
        `Hotel reservation ${bookingId}: ${booked} of ${expected} held nights could be booked; not confirmed`,
      );
      throw new Error(
        `Hotel reservation ${bookingId} has ${booked} of its ${expected} nights held; not confirmed`,
      );
    }
    return true;
  }

  /** PENDING_PAYMENT -> EXPIRED and release, in the caller's transaction. */
  private async expireOne(
    id: string,
    now: Date,
    session: ClientSession,
  ): Promise<boolean> {
    const moved = await transitionBooking(
      this.reservations,
      id,
      BookingStatus.PendingPayment,
      BookingStatus.Expired,
      { where: { holdExpiresAt: { $lte: now } }, session },
    );
    if (moved) {
      const expected = await this.expectedNights(id, session);
      const released = await this.inventory.releaseNights(id, session);
      if (released !== expected) {
        this.logger.error(
          `Expired hotel reservation ${id}: released ${released} of ${expected} held nights`,
        );
      }
    }
    return moved;
  }

  /** rooms x nights of a reservation, read in the caller's transaction. */
  private async expectedNights(
    id: string,
    session: ClientSession,
  ): Promise<number> {
    const r = await this.reservations
      .findById(id, { nights: 1, rooms: 1 }, { session })
      .lean()
      .exec();
    if (!r)
      throw new Error(`Hotel reservation ${id} disappeared mid-transaction`);
    return r.nights * r.rooms.length;
  }

  /**
   * HTL-18: an expired hold the job has not swept yet must not block these nights. Expire it here, in
   * this transaction (status-conditioned, so it cannot race the job into a double release).
   */
  private async expireStaleHolders(
    roomIds: string[],
    nights: string[],
    now: Date,
    session: ClientSession,
  ): Promise<void> {
    const stale = await this.inventory.staleHolders(
      roomIds,
      nights,
      now,
      session,
    );
    for (const id of stale) {
      if (!(await this.expireOne(id, now, session))) {
        // Its nights stay HELD past their expiry, so these rooms stay blocked: make it visible.
        this.logger.error(
          `Hotel reservation ${id} holds expired nights (${nights[0]}..${nights[nights.length - 1]}) but is not PENDING_PAYMENT; they were not released`,
        );
      }
    }
  }

  /** HTL-16: occupancy against the room data read inside the hold transaction. */
  private assertOccupancy(
    dto: HotelBookingRequestDto,
    rooms: { number: string; maxOccupancy: number }[],
  ): void {
    const errors = dto.rooms.flatMap((r, i) =>
      occupancyError(r, i, rooms[i].number, rooms[i].maxOccupancy),
    );
    if (errors.length) throw new ValidationFailedException(errors);
  }

  /** Validates the request against the live hotel and rooms; reports every input error at once. */
  private async plan(dto: HotelBookingRequestDto, now: Date): Promise<Plan> {
    const nights = eachNight(dto.checkIn, dto.checkOut);
    const roomIds = dto.rooms.map((r) => r.roomId);
    const stay = await this.inventory.getBookableStay(
      dto.hotelId,
      roomIds,
      nights,
    );
    if (!stay) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Hotel not found',
      );
    }
    const missing = stay.rooms.findIndex((r) => r === null);
    if (missing >= 0) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        `Room ${roomIds[missing]} is not a room of this hotel`,
      );
    }
    if (stay.unavailableReason) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        stay.unavailableReason,
      );
    }
    if (!stay.timeZone) {
      // Reference data defect (no airport maps the hotel's city to a zone), not the user's fault.
      this.logger.error(
        `Hotel ${stay.hotelId} has no known time zone; its reservations are refused`,
      );
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.SERVICE_UNAVAILABLE,
        `${stay.hotelName} cannot take reservations right now`,
      );
    }
    const timeZone = stay.timeZone;

    const errors: FieldError[] = [];
    const today = todayIn(timeZone, now);
    if (dto.checkIn < today) {
      errors.push({
        field: 'checkIn',
        message: `checkIn cannot be before today (${today} at the hotel)`,
      });
    }
    const seen = new Map<string, number>();
    dto.rooms.forEach((r, i) => {
      const first = seen.get(r.roomId);
      if (first !== undefined) {
        errors.push({
          field: `rooms[${i}].roomId`,
          message: `This room is already rooms[${first}]; each room is listed once`,
        });
      } else {
        seen.set(r.roomId, i);
      }
      const room = stay.rooms[i]!;
      errors.push(...occupancyError(r, i, room.number, room.maxOccupancy));
    });
    if (dto.rooms.every((r) => r.adults === 0)) {
      errors.push({
        field: 'rooms',
        message: 'A reservation needs at least one adult',
      });
    }
    if (errors.length) throw new ValidationFailedException(errors);

    const closed = stay.rooms.find((r) => r!.unavailableReason);
    if (closed) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        `${closed.unavailableReason!}. Nothing was held`,
      );
    }
    return { stay: { ...stay, timeZone }, nights };
  }
}

function occupancyError(
  r: { adults: number; childrenAges?: number[] },
  i: number,
  number: string,
  maxOccupancy: number,
): FieldError[] {
  const guests = r.adults + (r.childrenAges?.length ?? 0);
  if (guests === 0) {
    return [
      { field: `rooms[${i}]`, message: 'Each room needs at least one guest' },
    ];
  }
  if (guests > maxOccupancy) {
    return [
      {
        field: `rooms[${i}]`,
        message: `Room ${number} sleeps at most ${maxOccupancy}; ${guests} guests were assigned`,
      },
    ];
  }
  return [];
}

function notFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Reservation not found',
  );
}

function toDto(r: HotelReservationDocument): HotelReservationDto {
  return {
    id: r.id as string,
    status: r.status,
    hotelId: r.hotelId.toHexString(),
    hotelName: r.hotelName,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    nights: r.nights,
    timeZone: r.timeZone,
    rooms: r.rooms.map((room) => ({
      roomId: room.roomId.toHexString(),
      roomNumber: room.roomNumber,
      adults: room.adults,
      childrenAges: [...room.childrenAges],
      nightlyPriceMinor: room.nightlyPriceMinor,
      subtotalMinor: room.subtotalMinor,
    })),
    totalMinor: r.totalMinor,
    currency: r.currency,
    holdExpiresAt: r.holdExpiresAt,
    reference: r.reference,
    createdAt: r.createdAt,
  };
}

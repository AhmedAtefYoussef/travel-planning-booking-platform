import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { assertOwner } from '../../common/auth/access';
import { AuthUser, Role } from '../../common/auth/auth.types';
import {
  BookingStatus,
  BookingType,
  FLIGHT_INVENTORY,
  HOLD_DURATION_MS,
  transitionBooking,
  type BookableCabin,
  type FlightInventory,
  type PayableBooking,
  type PayableSnapshot,
} from '../../common/contracts';
import {
  AppException,
  ValidationFailedException,
  type FieldError,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { InvalidInputError } from '../../common/errors/invalid-input.error';
import { generateBookingReference } from '../../common/utils/booking-reference';
import { multiplyMinor, sumMinor } from '../../common/utils/money';
import type { EnvironmentVariables } from '../../config/env.validation';
import { partyErrors, priceParty } from '../flights';
import type {
  FlightBookingDto,
  FlightBookingRequestDto,
  FlightQuoteDto,
  PassengerDto,
} from './dto/flight-booking.dto';
import { ageOn, passengerTypeOn } from './passenger-age';
import {
  FlightBooking,
  type FlightBookingDocument,
  PassengerType,
  TripType,
} from './schemas/flight-booking.schema';

/** Everything a quote or a hold needs, validated once. */
interface Plan {
  quote: FlightQuoteDto;
  legs: BookableCabin[];
  seats: number;
}

const DUPLICATE_KEY = 11000;

/** API6 (sensitive business flows): one account cannot pin a cabin with endless unpaid holds. */
export const MAX_UNPAID_HOLDS_PER_USER = 3;

/** The expiry job's batch size; a full batch means more are due and is logged. */
export const EXPIRY_BATCH = 500;

/** No passenger is older than this on the travel date (catches typos such as 1900 for 1990). */
const MAX_AGE = 120;

/**
 * Flight bookings: FLT-21 summary, FLT-22 seat hold and expiry, FLT-19 passenger details, and the
 * FLIGHT_PAYABLE_BOOKING contract that PAY-01 confirms through.
 *
 * Seats are taken with FLIGHT_INVENTORY's single conditional update (ADR-0002). A round trip reserves
 * both legs and inserts the booking in ONE transaction, so it is held entirely or not at all.
 */
@Injectable()
export class FlightBookingsService implements PayableBooking {
  private readonly logger = new Logger(FlightBookingsService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(FLIGHT_INVENTORY) private readonly inventory: FlightInventory,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** FLT-21: the price and details of exactly what a hold would take; holds nothing. */
  async quote(
    dto: FlightBookingRequestDto,
    now: Date = new Date(),
  ): Promise<FlightQuoteDto> {
    return (await this.plan(dto, now)).quote;
  }

  /** FLT-22: holds the seats for 10 minutes as one PENDING_PAYMENT booking, or nothing at all. */
  async hold(
    user: AuthUser,
    dto: FlightBookingRequestDto,
    now: Date = new Date(),
  ): Promise<FlightBookingDto> {
    const { quote, legs, seats } = await this.plan(dto, now);
    const unpaid = await this.bookings.countDocuments({
      userId: new Types.ObjectId(user.id),
      status: BookingStatus.PendingPayment,
      holdExpiresAt: { $gt: now },
    });
    if (unpaid >= MAX_UNPAID_HOLDS_PER_USER) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        `You already have ${MAX_UNPAID_HOLDS_PER_USER} bookings waiting for payment; pay for one or let it expire first`,
      );
    }
    const session = await this.connection.startSession();
    try {
      let created: FlightBookingDocument | undefined;
      await session.withTransaction(async () => {
        for (const leg of legs) {
          const ok = await this.inventory.reserveSeats(
            leg.flightId,
            leg.cabinId,
            seats,
            session,
          );
          if (!ok) throw await this.reserveFailure(leg, seats, now);
        }
        // The 10 minutes start when the seats are taken, even after a transaction retry.
        const heldAt = new Date(Math.max(now.getTime(), Date.now()));
        [created] = await this.bookings.create(
          [
            {
              userId: new Types.ObjectId(user.id),
              tripType: quote.tripType,
              segments: quote.segments.map((s) => ({
                ...s,
                flightId: new Types.ObjectId(s.flightId),
                cabinId: new Types.ObjectId(s.cabinId),
                airlineId: new Types.ObjectId(
                  legs.find((l) => l.flightId === s.flightId)!.airlineId,
                ),
              })),
              passengers: quote.passengers,
              totalMinor: quote.totalMinor,
              currency: quote.currency,
              status: BookingStatus.PendingPayment,
              holdExpiresAt: new Date(heldAt.getTime() + HOLD_DURATION_MS),
              startsAt: legs[0].departureUtc,
              endsAt: legs[legs.length - 1].arrivalUtc,
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

  /** ACC-11: the owner sees their booking; an admin sees any; anyone else gets 404. */
  async findOne(user: AuthUser, id: string): Promise<FlightBookingDto> {
    const booking = Types.ObjectId.isValid(id)
      ? await this.bookings.findById(id).exec()
      : null;
    if (!booking) throw notFound();
    assertOwner(user, booking.userId, {
      bypassRoles: [Role.Admin],
      notFound: true,
    });
    return toDto(booking);
  }

  /**
   * FLT-22, GEN-11: moves every hold past its 10 minutes to EXPIRED and gives its seats back. Each
   * booking is expired and released in its own transaction (the transition is status-conditioned, so of
   * two concurrent runs only one releases). One failing booking is logged with its id and does not stop
   * the others; a full batch is logged because more holds are already due.
   */
  async expireHolds(now: Date = new Date()): Promise<number> {
    const due = await this.bookings
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
          moved = await transitionBooking(
            this.bookings,
            id,
            BookingStatus.PendingPayment,
            BookingStatus.Expired,
            { where: { holdExpiresAt: { $lte: now } }, session },
          );
          if (moved) await this.releaseAll(id, session);
        });
        if (moved) expired += 1;
      } catch (e) {
        this.logger.error(
          `Expiring flight hold ${id} failed; it stays held until the next run`,
          e instanceof Error ? e.stack : String(e),
        );
      } finally {
        await session.endSession();
      }
    }
    if (due.length === EXPIRY_BATCH) {
      this.logger.warn(
        `Flight hold expiry backlog: a full batch of ${EXPIRY_BATCH} was due; more holds are waiting`,
      );
    }
    if (expired) this.logger.log(`Expired ${expired} flight hold(s)`);
    return expired;
  }

  /** Gives back every segment's seats; a seat counter that no longer exists is logged, not ignored. */
  private async releaseAll(id: string, session: ClientSession): Promise<void> {
    const booking = await this.bookings
      .findById(id, { segments: 1 }, { session })
      .lean()
      .exec();
    if (!booking?.segments?.length) {
      throw new Error(`Flight booking ${id} has no segments to release`);
    }
    for (const s of booking.segments) {
      const released = await this.inventory.releaseSeats(
        s.flightId.toHexString(),
        s.cabinId.toHexString(),
        s.seats,
        session,
      );
      if (!released) {
        this.logger.error(
          `Booking ${id}: could not give ${s.seats} seat(s) back to flight ${s.flightId.toHexString()} cabin ${s.cabinId.toHexString()} (flight or cabin no longer exists)`,
        );
      }
    }
  }

  /* ----------------------------- FLIGHT_PAYABLE_BOOKING (PAY-01) ----------------------------- */

  async getPayable(
    bookingId: string,
    userId: string,
  ): Promise<PayableSnapshot> {
    const booking = Types.ObjectId.isValid(bookingId)
      ? await this.bookings.findById(bookingId).lean().exec()
      : null;
    if (!booking) throw notFound();
    // Someone else's booking is "not found", never "forbidden": no existence leak (ACC-11, API1).
    if (booking.userId.toHexString() !== userId) throw notFound();
    return {
      bookingType: BookingType.Flight,
      bookingId,
      userId,
      status: booking.status,
      amountMinor: booking.totalMinor,
      currency: booking.currency,
      holdExpiresAt: booking.holdExpiresAt,
      policiesAcceptedAt: booking.policiesAcceptedAt,
      reference: booking.reference,
    };
  }

  /**
   * PENDING_PAYMENT -> CONFIRMED with a fresh reference, only while the hold has not expired (a late
   * webhook cannot confirm an expired booking; PAY-01 refunds it instead). Idempotent: a replay for the
   * same payment is a no-op. Throws HOLD_EXPIRED / INVALID_STATE_TRANSITION otherwise.
   *
   * A reference collision (about 1 in 10^12) aborts a transaction, so inside the caller's session the
   * error is rethrown for the caller's withTransaction to retry the whole callback (drawing a new
   * reference); without a session it is retried here.
   */
  async markConfirmed(
    bookingId: string,
    input: { paymentId: string },
    session?: ClientSession,
    now: Date = new Date(),
  ): Promise<void> {
    const attempts = session ? 1 : 3;
    let moved = false;
    for (let attempt = 1; attempt <= attempts && !moved; attempt++) {
      try {
        moved = await transitionBooking(
          this.bookings,
          bookingId,
          BookingStatus.PendingPayment,
          BookingStatus.Confirmed,
          {
            where: { holdExpiresAt: { $gt: now } },
            set: {
              paymentId: new Types.ObjectId(input.paymentId),
              reference: generateBookingReference('FLIGHT'),
              confirmedAt: now,
            },
            session,
          },
        );
        if (!moved) break;
      } catch (e) {
        const collision = (e as { code?: number }).code === DUPLICATE_KEY;
        if (!collision || session) throw e;
        if (attempt === attempts) {
          throw new Error(
            `Could not allocate a unique booking reference for ${bookingId}`,
          );
        }
      }
    }
    if (moved) return;
    const current = await this.bookings
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
        ? 'The 10-minute hold on this booking has expired'
        : `This booking is ${current.status} and cannot be confirmed`,
    );
  }

  /**
   * The booking stays PENDING_PAYMENT so the user can retry until the hold expires (PAY-01). The
   * payments collection keeps the attempt and its error; this side checks the booking and logs.
   */
  async markPaymentFailed(
    bookingId: string,
    input: { paymentId: string; reason: string },
  ): Promise<void> {
    const booking = Types.ObjectId.isValid(bookingId)
      ? await this.bookings.findById(bookingId, { status: 1 }).lean().exec()
      : null;
    if (!booking) throw notFound();
    this.logger.warn(
      `Payment ${input.paymentId} for flight booking ${bookingId} (${booking.status}) failed: ${input.reason}`,
    );
  }

  /** Why taking the seats failed: the flight changed since validation, or the seats ran out. */
  private async reserveFailure(
    leg: BookableCabin,
    seats: number,
    now: Date,
  ): Promise<AppException> {
    const fresh = await this.inventory.getBookableCabin(
      leg.flightId,
      leg.cabinId,
      now,
    );
    if (!fresh) {
      return new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        `Flight ${leg.flightNumber} or its ${leg.cabinClass} cabin no longer exists`,
      );
    }
    if (fresh.unavailableReason) {
      return new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        fresh.unavailableReason,
      );
    }
    return new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.INSUFFICIENT_INVENTORY,
      `Not enough seats left in ${leg.cabinClass} on flight ${leg.flightNumber} for ${seats} passenger(s)`,
    );
  }

  /* ------------------------------------------ helpers ------------------------------------------ */

  /** Validates the request against the live flights and prices it; reports every error at once. */
  private async plan(dto: FlightBookingRequestDto, now: Date): Promise<Plan> {
    const outbound = await this.inventory.getBookableCabin(
      dto.outbound.flightId,
      dto.outbound.cabinId,
      now,
    );
    const inbound = dto.return
      ? await this.inventory.getBookableCabin(
          dto.return.flightId,
          dto.return.cabinId,
          now,
        )
      : undefined;
    if (!outbound || inbound === null) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        `${!outbound ? 'Outbound' : 'Return'} flight or cabin not found`,
      );
    }
    const legs = inbound ? [outbound, inbound] : [outbound];
    for (const leg of legs) {
      if (leg.unavailableReason) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          leg.unavailableReason,
        );
      }
    }

    const errors: FieldError[] = [];
    if (
      inbound &&
      (inbound.from !== outbound.to ||
        inbound.to !== outbound.from ||
        inbound.departureUtc <= outbound.arrivalUtc)
    ) {
      errors.push({
        field: 'return',
        message: `The return flight must fly ${outbound.to} -> ${outbound.from} and leave after the outbound flight lands`,
      });
    }

    const counts = { adults: 0, children: 0, infants: 0 };
    const documents = new Map<string, number>();
    dto.passengers.forEach((p, i) => {
      try {
        if (ageOn(p.dateOfBirth, outbound.departureLocalDate) > MAX_AGE) {
          errors.push({
            field: `passengers[${i}].dateOfBirth`,
            message: `A passenger cannot be older than ${MAX_AGE}; check the year of ${p.dateOfBirth}`,
          });
        } else {
          // FLT-12 b: the type must hold on every flight of the trip, because seats and fares are the
          // same for the whole booking.
          for (const leg of legs) {
            const actual = passengerTypeOn(
              p.dateOfBirth,
              leg.departureLocalDate,
            );
            if (actual !== p.type) {
              errors.push({
                field: `passengers[${i}].type`,
                message:
                  leg === outbound
                    ? `A passenger born ${p.dateOfBirth} travels as ${actual} on ${leg.departureLocalDate}, not ${p.type}`
                    : `This passenger is ${p.type} on the outbound flight but ${actual} on the return (${leg.departureLocalDate}); book the two flights separately`,
              });
              break;
            }
          }
        }
      } catch (e) {
        if (!(e instanceof InvalidInputError)) throw e;
        errors.push({
          field: `passengers[${i}].dateOfBirth`,
          message: e.message,
        });
      }
      const docKey = p.documentNumber.toUpperCase();
      const first = documents.get(docKey);
      if (first !== undefined) {
        errors.push({
          field: `passengers[${i}].documentNumber`,
          message: `The same document number is already used by passenger ${first + 1}`,
        });
      } else {
        documents.set(docKey, i);
      }
      if (p.type === PassengerType.Adult) counts.adults++;
      else if (p.type === PassengerType.Child) counts.children++;
      else counts.infants++;
      const bags = p.extraBags ?? 0;
      for (const leg of legs) {
        const max = leg.extraBaggage?.maxExtraBagsPerPassenger ?? 0;
        if (bags > max) {
          errors.push({
            field: `passengers[${i}].extraBags`,
            message: `Flight ${leg.flightNumber} allows at most ${max} extra bag(s) per passenger`,
          });
          break;
        }
      }
    });
    errors.push(
      ...partyErrors(counts).map((e) => ({
        field: 'passengers',
        message: e.message,
      })),
    );
    if (errors.length) throw new ValidationFailedException(errors);

    const prices = legs.map((leg) => priceParty(leg.fareMinor, counts));
    const totalBags = dto.passengers.reduce(
      (n, p) => n + (p.extraBags ?? 0),
      0,
    );
    const extraBagsMinor = sumMinor(
      legs.map((leg) =>
        multiplyMinor(leg.extraBaggage?.pricePerBagMinor ?? 0, totalBags),
      ),
    );
    const seats = prices[0].seats;
    const passengers: PassengerDto[] = dto.passengers.map((p) => ({
      type: p.type,
      firstName: p.firstName.trim(),
      lastName: p.lastName.trim(),
      dateOfBirth: p.dateOfBirth,
      documentNumber: p.documentNumber.toUpperCase(),
      extraBags: p.extraBags ?? 0,
    }));
    return {
      legs,
      seats,
      quote: {
        tripType: inbound ? TripType.RoundTrip : TripType.OneWay,
        segments: legs.map((leg) => ({
          flightId: leg.flightId,
          cabinId: leg.cabinId,
          cabinClass: leg.cabinClass,
          flightNumber: leg.flightNumber,
          from: leg.from,
          to: leg.to,
          departureUtc: leg.departureUtc,
          arrivalUtc: leg.arrivalUtc,
          seats,
          fareMinor: leg.fareMinor,
        })),
        passengers,
        fareMinor: outbound.fareMinor,
        infantFareMinor: prices[0].infantFareMinor,
        extraBagsMinor,
        totalMinor: sumMinor([
          ...prices.map((p) => p.totalMinor),
          extraBagsMinor,
        ]),
        currency: this.config.get('PLATFORM_CURRENCY', { infer: true }),
      },
    };
  }
}

function notFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Booking not found',
  );
}

function toDto(b: FlightBookingDocument): FlightBookingDto {
  return {
    id: b.id as string,
    status: b.status,
    tripType: b.tripType,
    segments: b.segments.map((s) => ({
      flightId: s.flightId.toHexString(),
      cabinId: s.cabinId.toHexString(),
      cabinClass: s.cabinClass,
      flightNumber: s.flightNumber,
      from: s.from,
      to: s.to,
      departureUtc: s.departureUtc,
      arrivalUtc: s.arrivalUtc,
      seats: s.seats,
      fareMinor: s.fareMinor,
    })),
    passengers: b.passengers.map((p) => ({
      type: p.type,
      firstName: p.firstName,
      lastName: p.lastName,
      dateOfBirth: p.dateOfBirth,
      documentNumber: p.documentNumber,
      extraBags: p.extraBags,
    })),
    totalMinor: b.totalMinor,
    currency: b.currency,
    holdExpiresAt: b.holdExpiresAt,
    reference: b.reference,
    createdAt: b.createdAt,
  };
}

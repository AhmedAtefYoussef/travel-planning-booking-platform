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
  NOTIFICATIONS_SERVICE,
  NotificationType,
  REFERENCE_SERVICE,
  transitionBooking,
  type Airport,
  type AirlinePolicySnapshot,
  type BookableCabin,
  type FlightInventory,
  type PayableBooking,
  type PayableSnapshot,
  REFUNDS_SERVICE,
  RefundReason,
  type RefundQuote,
  type RefundsService,
  type RefundSummary,
  type NotificationsService,
  type ReferenceService,
} from '../../common/contracts';
import {
  AppException,
  ValidationFailedException,
  type FieldError,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { InvalidInputError } from '../../common/errors/invalid-input.error';
import {
  generateBookingReference,
  isReferenceCollision,
} from '../../common/utils/booking-reference';
import { formatMinor, multiplyMinor, sumMinor } from '../../common/utils/money';
import type { EnvironmentVariables } from '../../config/env.validation';
import { partyErrors, priceParty } from '../flights';
import { UsersService } from '../users';
import type {
  FlightBookingDto,
  FlightBookingRequestDto,
  FlightQuoteDto,
  PassengerDto,
} from './dto/flight-booking.dto';
import { canPrint, renderETicket } from './e-ticket/e-ticket.renderer';
import { formatLocal, toETicketView } from './e-ticket/e-ticket.view';
import { assertUnpaidHoldsBelowCap, EXPIRY_BATCH } from './hold-limit';
import { ageOn, passengerTypeOn } from './passenger-age';
import { CancelledBy } from './schemas/booking-fields';
import { HoldGuard } from './schemas/hold-guard.schema';
import {
  FlightBooking,
  type FlightBookingDocument,
  type FlightSegment,
  PassengerType,
  TripType,
} from './schemas/flight-booking.schema';

/** Everything a quote or a hold needs, validated once. */
interface Plan {
  quote: FlightQuoteDto;
  legs: BookableCabin[];
  seats: number;
}

/** No passenger is older than this on the travel date (catches typos such as 1900 for 1990). */
const MAX_AGE = 120;

/**
 * Flight bookings: FLT-21 summary, FLT-22 seat hold and expiry, FLT-19 passenger details, FLT-26
 * cancellation with a tier-based refund, and the FLIGHT_PAYABLE_BOOKING contract that PAY-01 confirms
 * through.
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
    @InjectModel(HoldGuard.name)
    private readonly guards: Model<HoldGuard>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(FLIGHT_INVENTORY) private readonly inventory: FlightInventory,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    @Inject(REFUNDS_SERVICE) private readonly refunds: RefundsService,
    @Inject(NOTIFICATIONS_SERVICE)
    private readonly notifications: NotificationsService,
    @Inject(REFERENCE_SERVICE) private readonly reference: ReferenceService,
    private readonly users: UsersService,
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
    const session = await this.connection.startSession();
    try {
      let created: FlightBookingDocument | undefined;
      await session.withTransaction(async () => {
        await assertUnpaidHoldsBelowCap(
          this.guards,
          this.bookings,
          user.id,
          now,
          session,
          'flight bookings',
        );
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
              // The infant fare is derived from the stored fare, so it is not stored on the segment.
              segments: quote.segments.map((s) => ({
                ...s,
                infantFareMinor: undefined,
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
      notFoundMessage: notFound().message,
    });
    // PAY-03: the refund block, read through REFUNDS_SERVICE (never the payments module).
    return toDto(
      booking,
      await this.refunds.summaryFor(BookingType.Flight, booking.id as string),
    );
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

  /**
   * Gives back every segment's seats (outbound and return) for an expired hold or a cancelled booking.
   * `seats` counts adults and children only, so infants (on a lap) give nothing back. A seat counter
   * that no longer exists is logged, not ignored.
   */
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
      policiesVersion: booking.policySnapshot?.version ?? null,
      reference: booking.reference,
      providerActive: await this.airlinesActive(booking.segments),
    };
  }

  /** ACC-15: every airline of the booking still takes bookings. */
  private async airlinesActive(
    segments: { airlineId: Types.ObjectId }[],
  ): Promise<boolean> {
    const ids = new Set(segments.map((s) => s.airlineId.toHexString()));
    for (const id of ids) {
      if (!(await this.inventory.isAirlineActive(id))) return false;
    }
    return true;
  }

  /**
   * PENDING_PAYMENT -> CONFIRMED with a fresh reference, only while the hold has not expired (a late
   * webhook cannot confirm an expired booking; PAY-01 refunds it instead). Idempotent: a replay for the
   * same payment is a no-op. Throws HOLD_EXPIRED / INVALID_STATE_TRANSITION otherwise.
   *
   * A reference collision (about 1 in 10^12) aborts a transaction. Without a session it is retried here.
   * Inside the caller's session it is rethrown unchanged: withTransaction does NOT retry a duplicate-key
   * error, so the caller (PAY-01) must run its whole transaction again (see isReferenceCollision).
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
        const collision = isReferenceCollision(e);
        if (!collision || session) throw e;
        if (attempt === attempts) {
          throw new Error(
            `Could not allocate a unique booking reference for ${bookingId}`,
          );
        }
      }
    }
    if (moved) {
      // FLT-23: only the call that actually confirmed notifies (a replay returns below without one).
      // Seats need no move: a hold already took them from seatsAvailable (= total - booked - held,
      // one counter, ADR-0002), so a confirmed hold simply keeps them as booked seats.
      await this.notifyConfirmed(bookingId, session);
      return;
    }
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

  /** FLT-23: the in-app BOOKING_CONFIRMED notice, written in the confirming transaction. */
  private async notifyConfirmed(
    bookingId: string,
    session?: ClientSession,
  ): Promise<void> {
    const b = await this.bookings
      .findById(bookingId, null, { session })
      .lean()
      .exec();
    if (!b) throw new Error(`Confirmed flight booking ${bookingId} vanished`);
    const first = b.segments[0];
    // Reference data only decorates the notice: a lookup failure must not abort the confirmation.
    let airport: Airport | null = null;
    try {
      airport = await this.reference.getAirport(first.from);
    } catch (e) {
      this.logger.warn(
        `Booking ${bookingId}: airport ${first.from} lookup failed (${e instanceof Error ? e.message : String(e)}); the confirmation notice shows UTC`,
      );
    }
    const people = b.passengers.length;
    await this.notifications.notify(
      {
        userId: b.userId.toHexString(),
        type: NotificationType.BookingConfirmed,
        title: `Flight booking ${b.reference} confirmed`,
        body: `${trip(b.segments)}, departs ${formatLocal(first.departureUtc, airport?.timeZone ?? 'UTC')}; ${people} passenger${people === 1 ? '' : 's'}.`,
        link: `/bookings/flights/${bookingId}`,
      },
      session,
    );
  }

  /**
   * FLT-23: the owner's e-ticket PDF. Someone else's booking is 404 exactly like an unknown id (ACC-11);
   * only CONFIRMED or COMPLETED bookings have one (409 BOOKING_NOT_CONFIRMED otherwise).
   */
  async getETicket(
    user: AuthUser,
    id: string,
    now: Date = new Date(),
  ): Promise<{ filename: string; pdf: Buffer }> {
    const booking = await this.ownBooking(user, id);
    const ticketed =
      booking.status === BookingStatus.Confirmed ||
      booking.status === BookingStatus.Completed;
    if (!ticketed || !booking.reference) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_NOT_CONFIRMED,
        `This booking is ${booking.status}; an e-ticket exists only once it is confirmed`,
      );
    }
    const airports = new Map<string, Airport>();
    for (const code of new Set(
      booking.segments.flatMap((s) => [s.from, s.to]),
    )) {
      const airport = await this.reference.getAirport(code);
      if (airport) airports.set(code, airport);
      else
        this.logger.warn(
          `E-ticket ${id}: airport ${code} not in reference data`,
        );
    }
    const accepted = booking.policySnapshot?.airlines ?? [];
    const airlines: (AirlinePolicySnapshot | null)[] = [];
    for (const [i, s] of booking.segments.entries()) {
      const snap =
        accepted[i]?.flightNumber === s.flightNumber
          ? accepted[i]
          : accepted.find((a) => a.flightNumber === s.flightNumber);
      airlines.push(
        snap ??
          (await this.inventory.getAirlinePolicy(
            s.flightId.toHexString(),
            s.cabinId.toHexString(),
          )),
      );
    }
    const profile = await this.users.findProfile(booking.userId.toHexString());
    const pdf = await renderETicket(
      toETicketView({
        booking: { ...booking, reference: booking.reference },
        booker: profile?.name ?? 'Account holder',
        airports,
        airlines,
        now,
        canPrint,
      }),
    );
    return { filename: `e-ticket-${booking.reference}.pdf`, pdf };
  }

  /* ------------------------------- FLT-26 cancellation (GEN-11) ------------------------------- */

  /**
   * FLT-26: what cancelling now would refund, from the airline tiers accepted with the booking (PAY-02
   * snapshot, never the airline's current policy) and the outbound departure; a round trip is cancelled
   * as a whole on the outbound tier (FLT-12 a). Owner only (anyone else: the unknown-id 404, ACC-11);
   * 409 BOOKING_NOT_CONFIRMED unless CONFIRMED, 409 CANCELLATION_WINDOW_CLOSED once the flight left.
   */
  async refundQuote(
    user: AuthUser,
    id: string,
    now: Date = new Date(),
  ): Promise<RefundQuote> {
    const booking = await this.ownBooking(user, id);
    assertCancellable(booking, now, true);
    return this.cancellationQuote(booking, RefundReason.UserCancellation, now);
  }

  /** FLT-26: the owner cancels; answers the booking details with the refund block (PAY-03). */
  async cancel(
    user: AuthUser,
    id: string,
    now: Date = new Date(),
  ): Promise<FlightBookingDto> {
    // Strangers and wrong states fail here; cancelConfirmed checks again inside its transaction.
    assertCancellable(await this.ownBooking(user, id), now, true);
    await this.cancelConfirmed(
      id,
      { reason: RefundReason.UserCancellation },
      now,
    );
    return this.findOne(user, id);
  }

  /**
   * GEN-11 CONFIRMED -> CANCELLED: the core FLT-26 uses and FLT-06 (the airline cancels a flight:
   * RefundReason.ProviderCancellation, always 100%) can reuse. Ownership is the caller's job. In ONE
   * transaction:
   * - the status-conditioned transition: of two concurrent cancels exactly one wins, the other is 409
   *   and releases, refunds and notifies nothing;
   * - a user cancellation is re-checked against the outbound departure (409 CANCELLATION_WINDOW_CLOSED);
   * - every segment's seats go back to their cabin (releaseAll, shared with hold expiry);
   * - the refund through REFUNDS_SERVICE (none is recorded for 0%), linked as refundId;
   * - the owner's BOOKING_CANCELLED notice.
   */
  async cancelConfirmed(
    bookingId: string,
    options: { reason: RefundReason },
    now: Date = new Date(),
  ): Promise<void> {
    const byUser = options.reason === RefundReason.UserCancellation;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const booking = Types.ObjectId.isValid(bookingId)
          ? await this.bookings
              .findById(bookingId, null, { session })
              .lean()
              .exec()
          : null;
        if (!booking) throw notFound();
        assertCancellable(booking, now, byUser);
        const quote = this.cancellationQuote(booking, options.reason, now);
        if (!booking.paymentId) {
          throw new Error(
            `Confirmed flight booking ${bookingId} has no payment to refund`,
          );
        }
        const moved = await transitionBooking(
          this.bookings,
          bookingId,
          BookingStatus.Confirmed,
          BookingStatus.Cancelled,
          {
            where: byUser
              ? { 'segments.0.departureUtc': { $gt: now } }
              : undefined,
            set: {
              cancelledAt: now,
              cancelledBy: byUser ? CancelledBy.User : CancelledBy.Provider,
            },
            session,
          },
        );
        if (!moved) {
          throw new AppException(
            HttpStatus.CONFLICT,
            ErrorCode.BOOKING_NOT_CONFIRMED,
            'This booking was changed by another request and is no longer confirmed',
          );
        }
        await this.releaseAll(bookingId, session);
        const refund = await this.refunds.refundFor(
          {
            bookingType: BookingType.Flight,
            bookingId,
            userId: booking.userId.toHexString(),
            paymentId: booking.paymentId.toHexString(),
            quote,
            reason: options.reason,
          },
          session,
        );
        if (refund) {
          await this.bookings
            .updateOne(
              { _id: bookingId },
              { $set: { refundId: new Types.ObjectId(refund.refundId) } },
              { session },
            )
            .exec();
        }
        await this.notifications.notify(
          {
            userId: booking.userId.toHexString(),
            type: NotificationType.BookingCancelled,
            title: `Flight booking ${booking.reference} cancelled`,
            body: `${trip(booking.segments)}, is cancelled and its seats are released. ${refundLine(quote)}`,
            link: `/bookings/flights/${bookingId}`,
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }
  }

  /**
   * The refund for cancelling now: the amount paid, the OUTBOUND departure and the outbound airline's
   * tiers as accepted (PAY-02 snapshot). A Confirmed booking always has a snapshot (payment is blocked
   * until acceptance), so a missing one is a defect (500), never a silent 0%.
   */
  private cancellationQuote(
    booking: Pick<
      FlightBooking,
      'segments' | 'policySnapshot' | 'totalMinor' | 'currency'
    > & { _id: Types.ObjectId },
    reason: RefundReason,
    now: Date,
  ): RefundQuote {
    const outbound = booking.segments[0];
    const accepted = booking.policySnapshot?.airlines;
    const id = booking._id.toHexString();
    if (!accepted) {
      throw new Error(
        `Confirmed flight booking ${id} has no accepted policy snapshot (PAY-02)`,
      );
    }
    const terms =
      accepted[0]?.flightNumber === outbound.flightNumber
        ? accepted[0]
        : accepted.find((a) => a.flightNumber === outbound.flightNumber);
    if (!terms) {
      throw new Error(
        `Flight booking ${id}: the accepted policy snapshot has no terms for outbound flight ${outbound.flightNumber}`,
      );
    }
    return this.refunds.quote({
      paidMinor: booking.totalMinor,
      currency: booking.currency,
      eventStartUtc: outbound.departureUtc,
      tiers: terms.cancellationTiers,
      reason,
      now,
    });
  }

  /** ACC-11: the caller's own booking; anyone else's is the same 404 as an unknown id. */
  private async ownBooking(user: AuthUser, id: string) {
    const booking = Types.ObjectId.isValid(id)
      ? await this.bookings.findById(id).lean().exec()
      : null;
    if (!booking) throw notFound();
    assertOwner(user, booking.userId, {
      notFound: true,
      notFoundMessage: notFound().message,
    });
    return booking;
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
        } else if (p.dateOfBirth > latestToday(now)) {
          errors.push({
            field: `passengers[${i}].dateOfBirth`,
            message: `A date of birth cannot be in the future (${p.dateOfBirth})`,
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
      const weight = p.extraBagsWeightKg;
      const weightField = `passengers[${i}].extraBagsWeightKg`;
      if (bags === 0 && weight !== undefined) {
        errors.push({
          field: weightField,
          message: 'Give extraBagsWeightKg only together with extraBags',
        });
      } else if (bags > 0 && weight === undefined) {
        errors.push({
          field: weightField,
          message: 'Give the total weight in kg of the extra bags',
        });
      } else if (bags > 0 && weight !== undefined && weight < bags) {
        errors.push({
          field: weightField,
          message: `${bags} extra bag(s) weigh at least ${bags} kg in total`,
        });
      }
      for (const leg of legs) {
        const max = leg.extraBaggage?.maxExtraBagsPerPassenger ?? 0;
        if (bags > max) {
          errors.push({
            field: `passengers[${i}].extraBags`,
            message: `Flight ${leg.flightNumber} allows at most ${max} extra bag(s) per passenger`,
          });
          break;
        }
        // FLT-08: each extra bag has the same weight limit as the cabin's free bags.
        if (
          bags > 0 &&
          weight !== undefined &&
          weight > bags * leg.maxKgPerBag
        ) {
          errors.push({
            field: weightField,
            message: `Flight ${leg.flightNumber} allows ${leg.maxKgPerBag} kg per bag, so at most ${bags * leg.maxKgPerBag} kg for ${bags} extra bag(s)`,
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
      extraBagsWeightKg: p.extraBagsWeightKg ?? null,
    }));
    return {
      legs,
      seats,
      quote: {
        tripType: inbound ? TripType.RoundTrip : TripType.OneWay,
        segments: legs.map((leg, i) => ({
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
          infantFareMinor: prices[i].infantFareMinor,
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

/**
 * Today's date where it is latest on Earth (UTC+14), YYYY-MM-DD: a baby born today anywhere is never
 * refused, while a date of birth still to come everywhere is.
 */
function latestToday(now: Date): string {
  return new Date(now.getTime() + 14 * 3_600_000).toISOString().slice(0, 10);
}

/** "CDG -> HND -> CDG, flights HQ100 / HQ101": the route and flight numbers shown in notices. */
function trip(segments: readonly FlightSegment[]): string {
  const route = [segments[0].from, ...segments.map((s) => s.to)].join(' -> ');
  const flights = segments.map((s) => s.flightNumber).join(' / ');
  return `${route}, flight${segments.length > 1 ? 's' : ''} ${flights}`;
}

/** The refund sentence of the BOOKING_CANCELLED notice (amounts in the platform currency, PAY-04). */
function refundLine(quote: RefundQuote): string {
  return quote.amountMinor > 0
    ? `Refund: ${formatMinor(quote.amountMinor, quote.currency)} ${quote.currency} (${quote.refundPercent}%).`
    : 'No refund applies under the cancellation policy you accepted.';
}

/**
 * FLT-26, GEN-11: only a CONFIRMED booking can be cancelled (409 BOOKING_NOT_CONFIRMED), and a user
 * only before the outbound departure (409 CANCELLATION_WINDOW_CLOSED at or after it).
 */
function assertCancellable(
  b: Pick<FlightBooking, 'status' | 'segments'>,
  now: Date,
  beforeDeparture: boolean,
): void {
  if (b.status !== BookingStatus.Confirmed) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.BOOKING_NOT_CONFIRMED,
      `This booking is ${b.status}; only a confirmed booking can be cancelled`,
    );
  }
  if (
    beforeDeparture &&
    b.segments[0].departureUtc.getTime() <= now.getTime()
  ) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.CANCELLATION_WINDOW_CLOSED,
      'The flight has already departed, so this booking can no longer be cancelled',
    );
  }
}

function notFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Booking not found',
  );
}

function toDto(
  b: FlightBookingDocument,
  refund: RefundSummary | null = null,
): FlightBookingDto {
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
      extraBagsWeightKg: p.extraBagsWeightKg ?? null,
    })),
    totalMinor: b.totalMinor,
    currency: b.currency,
    holdExpiresAt: b.holdExpiresAt,
    reference: b.reference,
    refund,
    createdAt: b.createdAt,
  };
}

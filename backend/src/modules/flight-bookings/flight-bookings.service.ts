import { randomInt } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
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
  infantFareMinor,
  partyFareMinor,
  passengerMixErrors,
  passengerTypeFor,
  PassengerType,
  REFERENCE_SERVICE,
  type ConfirmedFlightBooking,
  type FlightBookingsLookup,
  type PassengerCounts,
  type PayableBooking,
  type PayableSnapshot,
  type ReferenceService,
} from '../../common/contracts';
import {
  AppException,
  ValidationFailedException,
  type FieldError,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { InvalidInputError } from '../../common/errors/invalid-input.error';
import { utcToLocalIso } from '../../common/utils/dates';
import { multiplyMinor, sumMinor } from '../../common/utils/money';
import type { EnvironmentVariables } from '../../config/env.validation';
import { Airline, Flight, FlightStatus } from '../flights';
import type {
  BookingSegmentDto,
  CreateFlightHoldDto,
  FlightBookingDto,
} from './dto/flight-booking.dto';
import {
  FlightBooking,
  type BookingSegment,
  type FlightBookingDocument,
} from './schemas/flight-booking.schema';

/** Unambiguous characters for references (no 0/O, 1/I/L). */
const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** F + 7 random characters: about 34 bits, unique index as the final guarantee (FLT-23). */
export function newFlightReference(): string {
  let ref = 'F';
  for (let i = 0; i < 7; i++) {
    ref += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }
  return ref;
}

const notFound = (what: string) =>
  new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    `${what} not found`,
  );

interface PricedSegment {
  segment: Omit<BookingSegment, 'subtotalMinor'> & { subtotalMinor: number };
  counts: PassengerCounts;
  fares: number;
  infantFares: number;
  baggage: number;
}

/**
 * Flight bookings (FLT-22 hold, FLT-23 confirmation, GEN-11 lifecycle), also exposed to other modules
 * as FLIGHT_PAYABLE_BOOKING (payments) and FLIGHT_BOOKINGS_LOOKUP (FLT-05 notifications).
 *
 * The hold validates everything first, prices the booking on the server, then takes the seats of
 * every segment and creates the booking in ONE transaction. Each seat grab is the ADR-0002
 * conditional update: it succeeds only if the cabin still has enough seats AND still has the price
 * that was quoted, so concurrent holds can never oversell a cabin and nobody pays a stale price.
 */
@Injectable()
export class FlightBookingsService
  implements PayableBooking, FlightBookingsLookup
{
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(REFERENCE_SERVICE) private readonly reference: ReferenceService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** POST /api/flight-bookings/hold (FLT-22, FLT-12, FLT-19). */
  async hold(
    user: AuthUser,
    dto: CreateFlightHoldDto,
    now: Date = new Date(),
  ): Promise<FlightBookingDto> {
    const priced = await this.validateAndPrice(dto, now);
    const holdExpiresAt = new Date(now.getTime() + HOLD_DURATION_MS);
    const passengers = dto.passengers.map((p, i) => ({
      fullName: p.fullName,
      dateOfBirth: p.dateOfBirth,
      documentNumber: p.documentNumber,
      extraBags: p.extraBags ?? 0,
      types: priced.map((s) => s.types[i]),
    }));
    const segments = priced.map((s) => s.priced.segment);

    const booking = await this.connection.transaction(async (session) => {
      for (const [i, s] of priced.entries()) {
        await this.takeSeats(i, s.priced.segment, now, session);
      }
      const [created] = await this.bookings.create(
        [
          {
            userId: new Types.ObjectId(user.id),
            status: BookingStatus.PendingPayment,
            segments,
            passengers,
            priceBreakdown: {
              faresMinor: sumMinor(priced.map((s) => s.priced.fares)),
              infantFaresMinor: sumMinor(
                priced.map((s) => s.priced.infantFares),
              ),
              baggageMinor: sumMinor(priced.map((s) => s.priced.baggage)),
            },
            totalMinor: sumMinor(segments.map((s) => s.subtotalMinor)),
            currency: this.platformCurrency,
            holdExpiresAt,
            lastArrivalUtc: segments[segments.length - 1].arrivalUtc,
          },
        ],
        { session },
      );
      return created;
    });
    return toFlightBookingDto(booking);
  }

  /** GET /api/flight-bookings/:id: the owner, or an admin (ACC-11, ACC-17). */
  async findForUser(user: AuthUser, id: string): Promise<FlightBookingDto> {
    const booking = await this.load(id);
    assertOwner(user, booking.userId, { bypassRoles: [Role.Admin] });
    return toFlightBookingDto(booking);
  }

  // ------------------------------------------------------------------------------------------------
  // FLIGHT_PAYABLE_BOOKING (PAY-01, FLT-23)
  // ------------------------------------------------------------------------------------------------

  async getPayable(
    bookingId: string,
    userId: string,
  ): Promise<PayableSnapshot> {
    const booking = await this.load(bookingId);
    if (booking.userId.toHexString() !== userId) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'You can only pay for your own bookings',
      );
    }
    return {
      bookingType: BookingType.Flight,
      bookingId: booking.id as string,
      userId: booking.userId.toHexString(),
      status: booking.status,
      amountMinor: booking.totalMinor,
      currency: booking.currency,
      holdExpiresAt: booking.holdExpiresAt,
      policiesAcceptedAt: booking.policiesAcceptedAt,
      reference: booking.reference ?? null,
    };
  }

  /**
   * PENDING_PAYMENT -> CONFIRMED, only while the hold is still running (ADR-0002: a late payment
   * cannot confirm an expired booking). The held seats simply stay taken: they become booked seats.
   * Idempotent for a replayed webhook of the same payment. A new reference is drawn on every
   * attempt; in the very unlikely case it collides, the unique index aborts the caller's
   * transaction and Stripe's retry draws another one.
   */
  async markConfirmed(
    bookingId: string,
    input: { paymentId: string },
    session?: ClientSession,
  ): Promise<void> {
    const now = new Date();
    if (!Types.ObjectId.isValid(input.paymentId)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'paymentId must be a 24-character hexadecimal id',
      );
    }
    const paymentId = new Types.ObjectId(input.paymentId);
    await this.assertFlightsStillScheduled(bookingId, session);
    const updated = await this.bookings
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
            reference: newFlightReference(),
            confirmedAt: now,
            lastPaymentError: null,
          },
        },
        { new: true, session },
      )
      .exec();
    if (updated) return;

    const current = await this.bookings
      .findById(bookingId)
      .session(session ?? null)
      .exec();
    if (!current) throw notFound('Booking');
    if (
      (current.status === BookingStatus.Confirmed ||
        current.status === BookingStatus.Completed) &&
      current.paymentId?.equals(paymentId)
    ) {
      return;
    }
    if (current.status === BookingStatus.PendingPayment) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.HOLD_EXPIRED,
        'The 10-minute hold has expired, so this booking can no longer be confirmed',
      );
    }
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.INVALID_STATE_TRANSITION,
      `A ${current.status} booking cannot be confirmed (GEN-11)`,
    );
  }

  /**
   * A booking on a flight that was cancelled (FLT-06) or has departed while the hold ran must not be
   * confirmed by a late payment; the payment is refunded instead (PAY-01). Only checked for unpaid
   * bookings, so a replayed webhook of a confirmed booking is still a no-op.
   */
  private async assertFlightsStillScheduled(
    bookingId: string,
    session?: ClientSession,
  ): Promise<void> {
    const booking = await this.bookings
      .findById(bookingId, { status: 1, segments: 1 })
      .session(session ?? null)
      .lean()
      .exec();
    if (!booking || booking.status !== BookingStatus.PendingPayment) return;
    const ids = booking.segments.map((s) => s.flightId);
    const scheduled = await this.flights
      .countDocuments({ _id: { $in: ids }, status: FlightStatus.Scheduled })
      .session(session ?? null)
      .exec();
    if (scheduled !== ids.length) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        'A flight of this booking is no longer scheduled, so the booking cannot be confirmed',
      );
    }
  }

  /** Keeps the booking PENDING_PAYMENT so the user can retry until the hold ends (PAY-01). */
  async markPaymentFailed(
    bookingId: string,
    input: { paymentId: string; reason: string },
  ): Promise<void> {
    await this.bookings
      .updateOne(
        { _id: bookingId, status: BookingStatus.PendingPayment },
        { $set: { lastPaymentError: input.reason.slice(0, 500) } },
      )
      .exec();
  }

  // ------------------------------------------------------------------------------------------------
  // FLIGHT_BOOKINGS_LOOKUP (FLT-05)
  // ------------------------------------------------------------------------------------------------

  async confirmedBookings(flightId: string): Promise<ConfirmedFlightBooking[]> {
    if (!Types.ObjectId.isValid(flightId)) return [];
    const rows = await this.bookings
      .find(
        {
          'segments.flightId': new Types.ObjectId(flightId),
          status: BookingStatus.Confirmed,
        },
        { userId: 1 },
      )
      .lean<{ _id: Types.ObjectId; userId: Types.ObjectId }[]>()
      .exec();
    return rows.map((r) => ({
      bookingId: r._id.toHexString(),
      userId: r.userId.toHexString(),
    }));
  }

  // ------------------------------------------------------------------------------------------------

  async load(id: string): Promise<FlightBookingDocument> {
    const booking = Types.ObjectId.isValid(id)
      ? await this.bookings.findById(id).exec()
      : null;
    if (!booking) throw notFound('Booking');
    return booking;
  }

  private get platformCurrency(): string {
    return this.config.get('PLATFORM_CURRENCY', { infer: true }).toUpperCase();
  }

  /**
   * ADR-0002 seat grab for one segment, inside the hold transaction. The filter re-checks
   * everything the price was based on, so the seats are taken only if the flight is still
   * Scheduled and in the future, and the cabin still has enough seats at the quoted fare.
   */
  private async takeSeats(
    index: number,
    segment: PricedSegment['segment'],
    now: Date,
    session: ClientSession,
  ): Promise<void> {
    const res = await this.flights
      .updateOne(
        {
          _id: segment.flightId,
          status: FlightStatus.Scheduled,
          departureUtc: { $gt: now },
          cabins: {
            $elemMatch: {
              _id: segment.cabinId,
              seatsAvailable: { $gte: segment.seats },
              priceMinor: segment.farePerSeatMinor,
            },
          },
        },
        { $inc: { 'cabins.$.seatsAvailable': -segment.seats } },
        { session },
      )
      .exec();
    if (res.modifiedCount === 1) return;

    const flight = await this.flights
      .findById(segment.flightId)
      .session(session)
      .lean()
      .exec();
    const cabin = flight?.cabins.find((c) => c._id.equals(segment.cabinId));
    const label = `${segment.flightNumber} ${segment.cabinClass}`;
    if (cabin && cabin.priceMinor !== segment.farePerSeatMinor) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        `The fare of ${label} changed while you were booking; search again to see the new price`,
        [{ field: `segments[${index}].cabinId`, message: 'The fare changed' }],
      );
    }
    if (!cabin || flight?.status !== FlightStatus.Scheduled) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        `${label} can no longer be booked`,
      );
    }
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.INSUFFICIENT_INVENTORY,
      `Only ${cabin.seatsAvailable} seat(s) left in ${label}; ${segment.seats} needed`,
      [
        {
          field: `segments[${index}].cabinId`,
          message: `Only ${cabin.seatsAvailable} seat(s) left`,
        },
      ],
    );
  }

  /**
   * Every rule that does not need the seat grab, reported together (GEN-02):
   * flights and cabins exist and are bookable, a return goes back the same way after the outbound
   * lands, passenger types from the date of birth on each flight's local date (FLT-12), at least
   * one adult and no more infants than adults per flight, extra bags within the airline's policy
   * (FLT-19). Returns each segment's priced snapshot and the passengers' types on it.
   */
  private async validateAndPrice(
    dto: CreateFlightHoldDto,
    now: Date,
  ): Promise<{ priced: PricedSegment; types: PassengerType[] }[]> {
    const errors: FieldError[] = [];
    if (
      dto.segments.length === 2 &&
      dto.segments[0].flightId === dto.segments[1].flightId
    ) {
      throw new ValidationFailedException([
        {
          field: 'segments[1].flightId',
          message: 'The return flight must be a different flight',
        },
      ]);
    }

    const seenDocuments = new Map<string, number>();
    for (const [p, passenger] of dto.passengers.entries()) {
      const first = seenDocuments.get(passenger.documentNumber);
      if (first !== undefined) {
        errors.push({
          field: `passengers[${p}].documentNumber`,
          message: `Passengers ${first + 1} and ${p + 1} have the same passport/ID number`,
        });
      } else {
        seenDocuments.set(passenger.documentNumber, p);
      }
    }

    const loaded = [];
    for (const [i, s] of dto.segments.entries()) {
      const flight = await this.flights.findById(s.flightId).lean().exec();
      if (!flight) throw notFound(`Flight ${s.flightId}`);
      const cabin = flight.cabins.find(
        (c) => c._id.toHexString() === s.cabinId,
      );
      if (!cabin) {
        errors.push({
          field: `segments[${i}].cabinId`,
          message: `Flight ${flight.flightNumber} has no cabin with this id`,
        });
        continue;
      }
      if (
        flight.status !== FlightStatus.Scheduled ||
        flight.departureUtc.getTime() <= now.getTime()
      ) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          `Flight ${flight.flightNumber} can no longer be booked (it is ${flight.departureUtc.getTime() <= now.getTime() && flight.status === FlightStatus.Scheduled ? 'departing' : flight.status.toLowerCase()})`,
        );
      }
      const airline = await this.airlines
        .findOne({ _id: flight.airlineId, ...ACTIVE_PROVIDER_FILTER })
        .lean()
        .exec();
      if (!airline) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          `Flight ${flight.flightNumber} can no longer be booked: its airline is not active (ACC-15)`,
        );
      }
      loaded.push({ flight, cabin, airline });
    }
    if (errors.length) throw new ValidationFailedException(errors);

    if (loaded.length === 2) {
      const [out, back] = loaded.map((l) => l.flight);
      if (back.from !== out.to || back.to !== out.from) {
        errors.push({
          field: 'segments[1].flightId',
          message: `A round trip returns from ${out.to} to ${out.from}; this flight goes from ${back.from} to ${back.to}`,
        });
      } else if (back.departureUtc.getTime() <= out.arrivalUtc.getTime()) {
        errors.push({
          field: 'segments[1].flightId',
          message:
            'The return flight must depart after the outbound flight lands',
        });
      }
    }

    const zones = new Map<string, string>();
    for (const code of new Set(
      loaded.flatMap((l) => [l.flight.from, l.flight.to]),
    )) {
      const airport = await this.reference.getAirport(code);
      if (!airport) throw new Error(`Airport ${code} is not seeded`);
      zones.set(code, airport.timeZone);
    }

    const result: { priced: PricedSegment; types: PassengerType[] }[] = [];
    for (const [i, { flight, cabin, airline }] of loaded.entries()) {
      const types: PassengerType[] = [];
      for (const [p, passenger] of dto.passengers.entries()) {
        try {
          types.push(
            passengerTypeFor(passenger.dateOfBirth, flight.departureLocalDate),
          );
        } catch (e) {
          if (!(e instanceof InvalidInputError)) throw e;
          if (i === 0) {
            errors.push({
              field: `passengers[${p}].dateOfBirth`,
              message: e.message,
            });
          }
          types.push(PassengerType.Adult);
        }
      }
      const counts: PassengerCounts = {
        adults: types.filter((t) => t === PassengerType.Adult).length,
        children: types.filter((t) => t === PassengerType.Child).length,
        infants: types.filter((t) => t === PassengerType.Infant).length,
      };
      for (const e of passengerMixErrors(counts)) {
        errors.push({
          field: 'passengers',
          message:
            loaded.length === 2
              ? `${e.message} on flight ${flight.flightNumber}`
              : e.message,
        });
      }

      const extra = airline.policy?.extraBaggage ?? null;
      let bags = 0;
      for (const [p, passenger] of dto.passengers.entries()) {
        const wanted = passenger.extraBags ?? 0;
        if (wanted === 0) continue;
        if (!extra || extra.maxExtraBagsPerPassenger === 0) {
          errors.push({
            field: `passengers[${p}].extraBags`,
            message: `${airline.name} sells no extra bags on flight ${flight.flightNumber}`,
          });
        } else if (wanted > extra.maxExtraBagsPerPassenger) {
          errors.push({
            field: `passengers[${p}].extraBags`,
            message: `${airline.name} allows at most ${extra.maxExtraBagsPerPassenger} extra bag(s) per passenger`,
          });
        }
        bags += wanted;
      }

      const fare = cabin.priceMinor;
      const party = partyFareMinor(fare, counts);
      const infantFares = multiplyMinor(infantFareMinor(fare), counts.infants);
      const baggage = extra ? multiplyMinor(extra.pricePerBagMinor, bags) : 0;
      result.push({
        types,
        priced: {
          counts,
          fares: party - infantFares,
          infantFares,
          baggage,
          segment: {
            flightId: flight._id,
            airlineId: airline._id,
            airlineName: airline.name,
            airlineCode: airline.code,
            cabinId: cabin._id,
            cabinClass: cabin.class,
            flightNumber: flight.flightNumber,
            from: flight.from,
            to: flight.to,
            fromTimeZone: zones.get(flight.from) as string,
            toTimeZone: zones.get(flight.to) as string,
            departureUtc: flight.departureUtc,
            arrivalUtc: flight.arrivalUtc,
            departureLocalDate: flight.departureLocalDate,
            seats: counts.adults + counts.children,
            farePerSeatMinor: fare,
            infantFareMinor: infantFareMinor(fare),
            freeBags: cabin.freeBags,
            maxKgPerBag: cabin.maxKgPerBag,
            extraBaggage: extra
              ? {
                  pricePerBagMinor: extra.pricePerBagMinor,
                  maxExtraBagsPerPassenger: extra.maxExtraBagsPerPassenger,
                }
              : null,
            cancellationTiers: (airline.policy?.cancellationTiers ?? []).map(
              (t) => ({
                daysBefore: t.daysBefore,
                refundPercent: t.refundPercent,
              }),
            ),
            subtotalMinor: sumMinor([party, baggage]),
          },
        },
      });
    }
    if (errors.length) throw new ValidationFailedException(errors);
    return result;
  }
}

export function toFlightBookingDto(
  booking: FlightBookingDocument,
): FlightBookingDto {
  return {
    id: booking.id as string,
    reference: booking.reference ?? null,
    status: booking.status,
    holdExpiresAt: booking.holdExpiresAt,
    segments: booking.segments.map(toSegmentDto),
    passengers: booking.passengers.map((p) => ({
      fullName: p.fullName,
      dateOfBirth: p.dateOfBirth,
      documentNumber: p.documentNumber,
      types: [...p.types],
      extraBags: p.extraBags,
    })),
    priceBreakdown: {
      faresMinor: booking.priceBreakdown.faresMinor,
      infantFaresMinor: booking.priceBreakdown.infantFaresMinor,
      baggageMinor: booking.priceBreakdown.baggageMinor,
    },
    totalMinor: booking.totalMinor,
    currency: booking.currency,
    policiesAcceptedAt: booking.policiesAcceptedAt ?? null,
    lastPaymentError: booking.lastPaymentError ?? null,
    confirmedAt: booking.confirmedAt ?? null,
    expiredAt: booking.expiredAt ?? null,
    completedAt: booking.completedAt ?? null,
    cancelledAt: booking.cancelledAt ?? null,
    createdAt: booking.createdAt,
  };
}

function toSegmentDto(s: BookingSegment): BookingSegmentDto {
  return {
    flightId: s.flightId.toHexString(),
    airlineName: s.airlineName,
    airlineCode: s.airlineCode,
    flightNumber: s.flightNumber,
    cabinId: s.cabinId.toHexString(),
    cabinClass: s.cabinClass,
    departure: {
      airport: s.from,
      timeZone: s.fromTimeZone,
      utc: s.departureUtc,
      local: utcToLocalIso(s.departureUtc, s.fromTimeZone),
    },
    arrival: {
      airport: s.to,
      timeZone: s.toTimeZone,
      utc: s.arrivalUtc,
      local: utcToLocalIso(s.arrivalUtc, s.toTimeZone),
    },
    seats: s.seats,
    farePerSeatMinor: s.farePerSeatMinor,
    infantFareMinor: s.infantFareMinor,
    freeBags: s.freeBags,
    maxKgPerBag: s.maxKgPerBag,
    extraBaggage: s.extraBaggage
      ? {
          pricePerBagMinor: s.extraBaggage.pricePerBagMinor,
          maxExtraBagsPerPassenger: s.extraBaggage.maxExtraBagsPerPassenger,
        }
      : null,
    cancellationTiers: s.cancellationTiers.map((t) => ({
      daysBefore: t.daysBefore,
      refundPercent: t.refundPercent,
    })),
    subtotalMinor: s.subtotalMinor,
  };
}

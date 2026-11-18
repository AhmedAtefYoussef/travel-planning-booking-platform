import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type FilterQuery, Model, Types } from 'mongoose';
import { assertProviderScope } from '../../common/auth/access';
import { ProviderType, type AuthUser } from '../../common/auth/auth.types';
import { BookingStatus } from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { paginate, type Page } from '../../common/pagination/pagination';
import { Flight } from '../flights';
import { Hotel } from '../hotels';
import { UsersService } from '../users';
import { effectiveStatus } from './booking-groups';
import {
  FLIGHT_MANIFEST_STATUSES,
  HOTEL_RESERVATION_STATUSES,
  type CabinSeatsDto,
  type FlightBookingOnFlightDto,
  type FlightBookingsQueryDto,
  type HotelReservationForHotelDto,
  type HotelReservationsQueryDto,
  type ManagedFlightDto,
} from './dto/provider-bookings.dto';
import { FlightBooking } from './schemas/flight-booking.schema';
import { HotelReservation } from './schemas/hotel-reservation.schema';

/** paginate() and lean() return plain documents, which always carry _id. */
type Lean<T> = T & { _id: Types.ObjectId };

/** FLT-29: a page of bookings together with the flight and its seats per cabin. */
export type FlightBookingsPage = Page<FlightBookingOnFlightDto> & {
  flight: ManagedFlightDto;
};

/** Shown for an account that no longer exists. */
const DELETED_USER = 'Deleted user';

/**
 * Read-only booking views for providers (ACC-11 exception: moderators see the bookings of their own
 * airline or hotel): FLT-29 bookings per flight and the passenger list as CSV, HTL-22 reservations per
 * hotel. The flight or hotel is loaded first (404 when unknown), then the provider scope is checked
 * (403 for another provider's moderator), so ids of other providers' bookings are never read.
 */
@Injectable()
export class ProviderBookingsService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly flightBookings: Model<FlightBooking>,
    @InjectModel(HotelReservation.name)
    private readonly reservations: Model<HotelReservation>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    private readonly users: UsersService,
  ) {}

  /** FLT-29: the flight's bookings (newest first, 10 per page) and its seats per cabin category. */
  async flightBookingsPage(
    user: AuthUser,
    flightId: string,
    query: FlightBookingsQueryDto,
    now: Date = new Date(),
  ): Promise<FlightBookingsPage> {
    const flight = await this.managedFlight(user, flightId);
    const filter: FilterQuery<FlightBooking> = {
      'segments.flightId': flight._id,
      status: query.status ?? { $in: [...FLIGHT_MANIFEST_STATUSES] },
    };
    const [page, cabins] = await Promise.all([
      paginate(this.flightBookings, filter, query.page, {
        sort: { createdAt: -1 },
      }),
      this.cabinSeats(flight, now),
    ]);
    const rows = page.items as Lean<FlightBooking>[];
    return {
      ...page,
      items: rows.map((b) => toFlightRow(b, flight._id)),
      flight: {
        id: flight._id.toHexString(),
        flightNumber: flight.flightNumber,
        from: flight.from,
        to: flight.to,
        departureUtc: flight.departureUtc,
        departureLocalDate: flight.departureLocalDate,
        status: flight.status,
        cabins,
      },
    };
  }

  /**
   * FLT-29: the passenger list of the flight as CSV, every passenger of its Confirmed (or, once landed,
   * Completed) bookings, by last name. Cancelled bookings are not on the list.
   */
  async passengerCsv(
    user: AuthUser,
    flightId: string,
  ): Promise<{ filename: string; csv: Buffer }> {
    const flight = await this.managedFlight(user, flightId);
    const bookings = await this.flightBookings
      .find(
        {
          'segments.flightId': flight._id,
          status: { $in: [BookingStatus.Confirmed, BookingStatus.Completed] },
        },
        { reference: 1, status: 1, segments: 1, passengers: 1 },
      )
      .lean()
      .exec();
    const rows = bookings.flatMap((b) => {
      const segment = b.segments.find((s) => s.flightId.equals(flight._id));
      return b.passengers.map((p) => ({
        reference: b.reference ?? '',
        status: b.status,
        cabinClass: segment?.cabinClass ?? '',
        type: p.type,
        lastName: p.lastName,
        firstName: p.firstName,
        extraBags: p.extraBags ?? 0,
      }));
    });
    rows.sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName) ||
        a.reference.localeCompare(b.reference),
    );
    const lines = [
      [
        'Booking reference',
        'Booking status',
        'Cabin',
        'Passenger type',
        'Last name',
        'First name',
        'Extra bags',
      ],
      ...rows.map((r) => [
        r.reference,
        r.status,
        r.cabinClass,
        r.type,
        r.lastName,
        r.firstName,
        String(r.extraBags),
      ]),
    ].map((cells) => cells.map(csvCell).join(','));
    // UTF-8 BOM so spreadsheet apps read accented names correctly; CRLF line ends (RFC 4180).
    const csv = Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
    return {
      filename: `passengers-${flight.flightNumber}-${flight.departureLocalDate}.csv`,
      csv,
    };
  }

  /** HTL-22: the hotel's reservations, latest check-in first, 10 per page. */
  async hotelReservationsPage(
    user: AuthUser,
    hotelId: string,
    query: HotelReservationsQueryDto,
    now: Date = new Date(),
  ): Promise<Page<HotelReservationForHotelDto>> {
    const hotel = Types.ObjectId.isValid(hotelId)
      ? await this.hotels.findById(hotelId, { _id: 1 }).lean().exec()
      : null;
    if (!hotel) throw notFound('Hotel not found');
    assertProviderScope(user, ProviderType.Hotel, hotel._id);
    const page = await paginate(
      this.reservations,
      {
        hotelId: hotel._id,
        status: query.status ?? { $in: [...HOTEL_RESERVATION_STATUSES] },
      },
      query.page,
      { sort: { startsAt: -1 } },
    );
    const rows = page.items as Lean<HotelReservation>[];
    const names = await this.namesOf(rows.map((r) => r.userId));
    return {
      ...page,
      items: rows.map((r) => {
        const status = effectiveStatus(r, now);
        return {
          id: r._id.toHexString(),
          reference: r.reference ?? null,
          status,
          guestName: names.get(r.userId.toHexString()) ?? DELETED_USER,
          adults: r.rooms.reduce((n, room) => n + room.adults, 0),
          children: r.rooms.reduce(
            (n, room) => n + (room.childrenAges?.length ?? 0),
            0,
          ),
          rooms: r.rooms.map((room) => ({
            roomId: room.roomId.toHexString(),
            roomNumber: room.roomNumber,
            adults: room.adults,
            childrenAges: room.childrenAges ?? [],
          })),
          checkIn: r.checkIn,
          checkOut: r.checkOut,
          nights: r.nights,
          totalMinor: r.totalMinor,
          currency: r.currency,
          createdAt: r.createdAt,
        };
      }),
    };
  }

  /** The flight (404 when unknown) of the caller's own airline (403 otherwise). */
  private async managedFlight(
    user: AuthUser,
    flightId: string,
  ): Promise<Lean<Flight>> {
    const flight = Types.ObjectId.isValid(flightId)
      ? await this.flights.findById(flightId).lean<Lean<Flight>>().exec()
      : null;
    if (!flight) throw notFound('Flight not found');
    assertProviderScope(user, ProviderType.Airline, flight.airlineId);
    return flight;
  }

  /**
   * Seats per cabin: remaining is the flight's live counter (total - booked - held, FLT-22); booked
   * and held are summed from this flight's segments of Confirmed bookings and of unexpired holds.
   */
  private async cabinSeats(
    flight: Lean<Flight>,
    now: Date,
  ): Promise<CabinSeatsDto[]> {
    const sums = await this.flightBookings
      .aggregate<{
        _id: { cabinId: Types.ObjectId; held: boolean };
        seats: number;
      }>([
        {
          $match: {
            'segments.flightId': flight._id,
            $or: [
              { status: BookingStatus.Confirmed },
              {
                status: BookingStatus.PendingPayment,
                holdExpiresAt: { $gt: now },
              },
            ],
          },
        },
        { $unwind: '$segments' },
        { $match: { 'segments.flightId': flight._id } },
        {
          $group: {
            _id: {
              cabinId: '$segments.cabinId',
              held: { $eq: ['$status', BookingStatus.PendingPayment] },
            },
            seats: { $sum: '$segments.seats' },
          },
        },
      ])
      .exec();
    const seatsOf = (cabinId: Types.ObjectId, held: boolean) =>
      sums.find((s) => s._id.cabinId.equals(cabinId) && s._id.held === held)
        ?.seats ?? 0;
    return flight.cabins.map((c) => ({
      cabinId: c._id.toHexString(),
      cabinClass: c.class,
      totalSeats: c.totalSeats,
      seatsRemaining: c.seatsAvailable,
      seatsBooked: seatsOf(c._id, false),
      seatsHeld: seatsOf(c._id, true),
    }));
  }

  /** Account id -> name, one lookup per distinct account on the page. */
  private async namesOf(ids: Types.ObjectId[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.map((id) => id.toHexString()))];
    const profiles = await Promise.all(
      unique.map((id) => this.users.findProfile(id)),
    );
    const names = new Map<string, string>();
    unique.forEach((id, i) => {
      const profile = profiles[i];
      if (profile) names.set(id, profile.name);
    });
    return names;
  }
}

/** The booking as the airline sees it on this flight (its own segment of a round trip). */
function toFlightRow(
  b: Lean<FlightBooking>,
  flightId: Types.ObjectId,
): FlightBookingOnFlightDto {
  const segment =
    b.segments.find((s) => s.flightId.equals(flightId)) ?? b.segments[0];
  return {
    id: b._id.toHexString(),
    reference: b.reference ?? '',
    status: b.status,
    cabinClass: segment.cabinClass,
    seats: segment.seats,
    passengers: b.passengers.map((p) => ({
      type: p.type,
      firstName: p.firstName,
      lastName: p.lastName,
      extraBags: p.extraBags ?? 0,
    })),
    tripType: b.tripType,
    confirmedAt: b.confirmedAt ?? null,
    cancelledAt: b.cancelledAt ?? null,
  };
}

/**
 * One CSV cell (RFC 4180): always quoted, quotes doubled. A cell that a spreadsheet would run as a
 * formula (starting with = + - @, a tab or a carriage return) is prefixed with ' (OWASP CSV injection),
 * because passenger names are typed by users.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function notFound(message: string): AppException {
  return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, message);
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type FilterQuery, Model, Types } from 'mongoose';
import { ownerFilter } from '../../common/auth/access';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  BookingStatus,
  REFERENCE_SERVICE,
  type ReferenceService,
} from '../../common/contracts';
import { paginate, type Page } from '../../common/pagination/pagination';
import { isValidTimeZone, utcToLocalIso } from '../../common/utils/dates';
import {
  bookingGroupFilter,
  bookingGroupSort,
  effectiveStatus,
  groupOf,
  type BookingGroup,
} from './booking-groups';
import type {
  MyBookingsQueryDto,
  MyFlightBookingDto,
  MyHotelReservationDto,
} from './dto/my-bookings.dto';
import { FlightBooking } from './schemas/flight-booking.schema';
import { HotelReservation } from './schemas/hotel-reservation.schema';

/** paginate() returns lean documents, which always carry _id. */
type Lean<T> = T & { _id: Types.ObjectId };

/** Shown for an airport missing from the reference data, so the list still renders (logged). */
const FALLBACK_ZONE = 'UTC';

/**
 * FLT-25 and HTL-20: the signed-in user's own flight bookings and hotel reservations, one group at a
 * time (Upcoming, Past, Cancelled; booking-groups.ts), 10 per page (GEN-05). The owner filter is part
 * of the query, so another user's bookings are never even read (ACC-11). The full details of one
 * booking stay on GET /api/flight-bookings/{id} and GET /api/hotel-bookings/{id}.
 */
@Injectable()
export class MyBookingsService {
  private readonly logger = new Logger(MyBookingsService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly flights: Model<FlightBooking>,
    @InjectModel(HotelReservation.name)
    private readonly hotels: Model<HotelReservation>,
    @Inject(REFERENCE_SERVICE) private readonly reference: ReferenceService,
  ) {}

  /** FLT-25: reference, flights with local times (GEN-06), passengers, cabin and status. */
  async flightBookings(
    user: AuthUser,
    query: MyBookingsQueryDto,
    now: Date = new Date(),
  ): Promise<Page<MyFlightBookingDto>> {
    const page = await paginate(
      this.flights,
      mine<FlightBooking>(user, query.group, now),
      query.page,
      { sort: bookingGroupSort(query.group) },
    );
    const rows = page.items as Lean<FlightBooking>[];
    const zones = await this.zonesOf(
      rows.flatMap((b) => b.segments.flatMap((s) => [s.from, s.to])),
    );
    return {
      ...page,
      items: rows.map((b) => toFlightRow(b, zones, query.group, now)),
    };
  }

  /** HTL-20: reference, hotel, rooms, dates, guests, total and status. */
  async hotelReservations(
    user: AuthUser,
    query: MyBookingsQueryDto,
    now: Date = new Date(),
  ): Promise<Page<MyHotelReservationDto>> {
    const page = await paginate(
      this.hotels,
      mine<HotelReservation>(user, query.group, now),
      query.page,
      { sort: bookingGroupSort(query.group) },
    );
    const rows = page.items as Lean<HotelReservation>[];
    return {
      ...page,
      items: rows.map((r) => toHotelRow(r, query.group, now)),
    };
  }

  /** IATA code -> IANA zone, one reference lookup per distinct airport on the page. */
  private async zonesOf(codes: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(codes)];
    const airports = await Promise.all(
      unique.map((code) => this.reference.getAirport(code)),
    );
    const zones = new Map<string, string>();
    unique.forEach((code, i) => {
      const zone = airports[i]?.timeZone;
      if (zone && isValidTimeZone(zone)) {
        zones.set(code, zone);
      } else {
        this.logger.warn(
          `Airport ${code} has no valid time zone in the reference data; showing UTC (GEN-06)`,
        );
        zones.set(code, FALLBACK_ZONE);
      }
    });
    return zones;
  }
}

/** The caller's own bookings in one group (ACC-11: the owner filter is part of the query). */
function mine<T>(
  user: AuthUser,
  group: BookingGroup,
  now: Date,
): FilterQuery<T> {
  return {
    ...ownerFilter(user),
    ...bookingGroupFilter(group, now),
  } as FilterQuery<T>;
}

/** The hold end is only meaningful while the booking is still an unpaid hold. */
function holdEnd(
  b: { status: BookingStatus; holdExpiresAt: Date },
  status: BookingStatus,
): Date | null {
  return status === BookingStatus.PendingPayment ? b.holdExpiresAt : null;
}

function toFlightRow(
  b: Lean<FlightBooking>,
  zones: ReadonlyMap<string, string>,
  group: BookingGroup,
  now: Date,
): MyFlightBookingDto {
  const status = effectiveStatus(b, now);
  return {
    id: b._id.toHexString(),
    reference: b.reference ?? null,
    status,
    group: groupOf(b, now) ?? group,
    tripType: b.tripType,
    cabinClass: b.segments[0].cabinClass,
    segments: b.segments.map((s) => {
      const depZone = zones.get(s.from) ?? FALLBACK_ZONE;
      const arrZone = zones.get(s.to) ?? FALLBACK_ZONE;
      return {
        flightNumber: s.flightNumber,
        from: s.from,
        to: s.to,
        cabinClass: s.cabinClass,
        departureUtc: s.departureUtc,
        arrivalUtc: s.arrivalUtc,
        departureLocal: utcToLocalIso(s.departureUtc, depZone),
        arrivalLocal: utcToLocalIso(s.arrivalUtc, arrZone),
        departureTimeZone: depZone,
        arrivalTimeZone: arrZone,
      };
    }),
    passengers: b.passengers.map((p) => ({
      type: p.type,
      firstName: p.firstName,
      lastName: p.lastName,
    })),
    passengerCount: b.passengers.length,
    totalMinor: b.totalMinor,
    currency: b.currency,
    holdExpiresAt: holdEnd(b, status),
    createdAt: b.createdAt,
  };
}

function toHotelRow(
  r: Lean<HotelReservation>,
  group: BookingGroup,
  now: Date,
): MyHotelReservationDto {
  const status = effectiveStatus(r, now);
  return {
    id: r._id.toHexString(),
    reference: r.reference ?? null,
    status,
    group: groupOf(r, now) ?? group,
    hotelId: r.hotelId.toHexString(),
    hotelName: r.hotelName,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    nights: r.nights,
    rooms: r.rooms.map((room) => ({
      roomId: room.roomId.toHexString(),
      roomNumber: room.roomNumber,
      adults: room.adults,
      childrenAges: room.childrenAges ?? [],
    })),
    guests: {
      adults: r.rooms.reduce((n, room) => n + room.adults, 0),
      children: r.rooms.reduce(
        (n, room) => n + (room.childrenAges?.length ?? 0),
        0,
      ),
    },
    totalMinor: r.totalMinor,
    currency: r.currency,
    holdExpiresAt: holdEnd(r, status),
    createdAt: r.createdAt,
  };
}

import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProviderType } from '../../common/auth/auth.types';
import {
  AIRLINE_STATUS,
  BookingType,
  type ProviderStatus,
} from '../../common/contracts';
import { ValidationFailedException } from '../../common/errors/app.exception';
import {
  PAGE_SIZE,
  skipFor,
  toPage,
  type Page,
} from '../../common/pagination/pagination';
import { UsersService } from '../users';
import type {
  AdminBookingDto,
  AdminBookingsQueryDto,
} from './dto/admin-bookings.dto';
import {
  bookingRowsPipeline,
  type BookingRow,
  travelRangeMatch,
} from './admin-booking-rows';
import { FlightBooking } from './schemas/flight-booking.schema';
import { HotelReservation } from './schemas/hotel-reservation.schema';

const DELETED_USER = 'Deleted user';

/**
 * ACC-17: the admin's read-only list of every flight booking and hotel reservation, newest first, 10
 * per page (GEN-05), filterable by type, status and a travel-date range. Both collections are read in
 * one aggregation ($unionWith), so sorting and paging are exact across them. Nothing here writes.
 */
@Injectable()
export class AdminBookingsService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly flights: Model<FlightBooking>,
    @InjectModel(HotelReservation.name)
    private readonly hotels: Model<HotelReservation>,
    @Inject(AIRLINE_STATUS) private readonly airlines: ProviderStatus,
    private readonly users: UsersService,
  ) {}

  async list(query: AdminBookingsQueryDto): Promise<Page<AdminBookingDto>> {
    if (query.from && query.to && query.to < query.from) {
      throw new ValidationFailedException([
        { field: 'to', message: 'to must be on or after from' },
      ]);
    }
    const { onHotels, pipeline } = bookingRowsPipeline(
      query.type,
      matchFor(query),
      [
        { $sort: { createdAt: -1, _id: -1 } },
        {
          $facet: {
            items: [{ $skip: skipFor(query.page) }, { $limit: PAGE_SIZE }],
            total: [{ $count: 'n' }],
          },
        },
      ],
    );
    const [result] = onHotels
      ? await this.hotels.aggregate<Facet>(pipeline).exec()
      : await this.flights.aggregate<Facet>(pipeline).exec();
    const rows = result?.items ?? [];
    const [users, airlines] = await Promise.all([
      this.usersOf(rows),
      this.airlinesOf(rows),
    ]);
    return toPage(
      rows.map((r) => toDto(r, users, airlines)),
      result?.total[0]?.n ?? 0,
      query.page,
    );
  }

  /** Account id -> name and email for the accounts on the page, in one query. */
  private async usersOf(
    rows: BookingRow[],
  ): Promise<Map<string, { name: string; email: string }>> {
    const ids = [...new Set(rows.map((r) => r.userId.toHexString()))];
    const profiles = await this.users.findProfiles(ids);
    return new Map(
      profiles.map((p) => [p.id, { name: p.name, email: p.email }]),
    );
  }

  /** Airline id -> name for the flight rows (hotel names are stored on the reservation). */
  private async airlinesOf(rows: BookingRow[]): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        rows
          .filter((r) => r.type === BookingType.Flight)
          .map((r) => r.providerId.toHexString()),
      ),
    ];
    if (ids.length === 0) return new Map();
    const found = new Map(
      (await this.airlines.findMany(ids)).map((a) => [a.id, a.name]),
    );
    return new Map(
      ids.map((id) => [id, found.get(id) ?? 'Unknown airline'] as const),
    );
  }
}

interface Facet {
  items: BookingRow[];
  total: { n: number }[];
}

/** The filters shared by both collections; dates are UTC calendar days, both ends included. */
function matchFor(query: AdminBookingsQueryDto): Record<string, unknown> {
  const match = travelRangeMatch(query.from, query.to);
  if (query.status) match.status = query.status;
  return match;
}

function toDto(
  r: BookingRow,
  users: ReadonlyMap<string, { name: string; email: string }>,
  airlines: ReadonlyMap<string, string>,
): AdminBookingDto {
  const userId = r.userId.toHexString();
  const providerId = r.providerId.toHexString();
  const user = users.get(userId);
  const flight = r.type === BookingType.Flight;
  return {
    id: r._id.toHexString(),
    type: r.type,
    reference: r.reference ?? null,
    status: r.status,
    user: {
      id: userId,
      name: user?.name ?? DELETED_USER,
      email: user?.email ?? null,
    },
    provider: {
      type: flight ? ProviderType.Airline : ProviderType.Hotel,
      id: providerId,
      name: flight
        ? (airlines.get(providerId) ?? 'Unknown airline')
        : (r.hotelName ?? ''),
    },
    summary: flight
      ? (r.segments ?? [])
          .map((s) => `${s.flightNumber} ${s.from} -> ${s.to}`)
          .join(', ')
      : `${r.roomNumbers?.length ?? 0} room(s): ${(r.roomNumbers ?? []).join(', ')}`,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    checkIn: r.checkIn ?? null,
    checkOut: r.checkOut ?? null,
    totalMinor: r.totalMinor,
    currency: r.currency,
    createdAt: r.createdAt,
  };
}

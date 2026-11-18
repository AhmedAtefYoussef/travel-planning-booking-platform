import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type PipelineStage, Types } from 'mongoose';
import { ProviderType } from '../../common/auth/auth.types';
import {
  AIRLINE_STATUS,
  BookingStatus,
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
import { addDays } from '../../common/utils/dates';
import { UsersService } from '../users';
import type {
  AdminBookingDto,
  AdminBookingsQueryDto,
} from './dto/admin-bookings.dto';
import { FlightBooking } from './schemas/flight-booking.schema';
import {
  HOTEL_RESERVATIONS_COLLECTION,
  HotelReservation,
} from './schemas/hotel-reservation.schema';

/** One row of either collection, projected to the shape both share. */
interface BookingRow {
  _id: Types.ObjectId;
  type: BookingType;
  reference: string | null;
  status: BookingStatus;
  userId: Types.ObjectId;
  providerId: Types.ObjectId;
  hotelName: string | null;
  segments: { flightNumber: string; from: string; to: string }[] | null;
  roomNumbers: string[] | null;
  startsAt: Date;
  endsAt: Date;
  checkIn: string | null;
  checkOut: string | null;
  totalMinor: number;
  currency: string;
  createdAt: Date;
}

const FLIGHT_ROW: Record<string, unknown> = {
  type: { $literal: BookingType.Flight },
  reference: 1,
  status: 1,
  userId: 1,
  providerId: { $arrayElemAt: ['$segments.airlineId', 0] },
  hotelName: { $literal: null },
  segments: {
    $map: {
      input: '$segments',
      as: 's',
      in: { flightNumber: '$$s.flightNumber', from: '$$s.from', to: '$$s.to' },
    },
  },
  roomNumbers: { $literal: null },
  startsAt: 1,
  endsAt: 1,
  checkIn: { $literal: null },
  checkOut: { $literal: null },
  totalMinor: 1,
  currency: 1,
  createdAt: 1,
};

const HOTEL_ROW: Record<string, unknown> = {
  type: { $literal: BookingType.Hotel },
  reference: 1,
  status: 1,
  userId: 1,
  providerId: '$hotelId',
  hotelName: 1,
  segments: { $literal: null },
  roomNumbers: '$rooms.roomNumber',
  startsAt: 1,
  endsAt: 1,
  checkIn: 1,
  checkOut: 1,
  totalMinor: 1,
  currency: 1,
  createdAt: 1,
};

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
    const match = matchFor(query);
    const rowsOf = (shape: Record<string, unknown>): PipelineStage[] => [
      { $match: match },
      { $project: shape } as PipelineStage,
    ];
    const page: PipelineStage[] = [
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $facet: {
          items: [{ $skip: skipFor(query.page) }, { $limit: PAGE_SIZE }],
          total: [{ $count: 'n' }],
        },
      },
    ];
    const pipeline: PipelineStage[] =
      query.type === undefined
        ? [
            ...rowsOf(FLIGHT_ROW),
            {
              $unionWith: {
                coll: HOTEL_RESERVATIONS_COLLECTION,
                pipeline: rowsOf(HOTEL_ROW),
              },
            } as PipelineStage,
            ...page,
          ]
        : [
            ...rowsOf(
              query.type === BookingType.Flight ? FLIGHT_ROW : HOTEL_ROW,
            ),
            ...page,
          ];
    // Hotel reservations only: run on hotel_reservations; otherwise start from flight_bookings.
    const [result] =
      query.type === BookingType.Hotel
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

  /** Account id -> name and email, one lookup per distinct account on the page. */
  private async usersOf(
    rows: BookingRow[],
  ): Promise<Map<string, { name: string; email: string }>> {
    const ids = [...new Set(rows.map((r) => r.userId.toHexString()))];
    const profiles = await Promise.all(
      ids.map((id) => this.users.findProfile(id)),
    );
    const out = new Map<string, { name: string; email: string }>();
    ids.forEach((id, i) => {
      const p = profiles[i];
      if (p) out.set(id, { name: p.name, email: p.email });
    });
    return out;
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
    const found = await Promise.all(ids.map((id) => this.airlines.find(id)));
    const out = new Map<string, string>();
    ids.forEach((id, i) => out.set(id, found[i]?.name ?? 'Unknown airline'));
    return out;
  }
}

interface Facet {
  items: BookingRow[];
  total: { n: number }[];
}

/** The filters shared by both collections; dates are UTC calendar days, both ends included. */
function matchFor(query: AdminBookingsQueryDto): Record<string, unknown> {
  const match: Record<string, unknown> = {};
  if (query.status) match.status = query.status;
  if (query.from) match.endsAt = { $gt: new Date(`${query.from}T00:00:00Z`) };
  if (query.to) {
    match.startsAt = { $lt: new Date(`${addDays(query.to, 1)}T00:00:00Z`) };
  }
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

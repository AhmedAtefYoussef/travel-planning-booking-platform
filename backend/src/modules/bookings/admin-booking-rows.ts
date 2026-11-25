import type { PipelineStage, Types } from 'mongoose';
import { BookingType, type BookingStatus } from '../../common/contracts';
import { addDays } from '../../common/utils/dates';
import { HOTEL_RESERVATIONS_COLLECTION } from './schemas/hotel-reservation.schema';

/** One row of either collection, projected to the shape both share. */
export interface BookingRow {
  _id: Types.ObjectId;
  type: BookingType;
  reference: string | null;
  status: BookingStatus;
  userId: Types.ObjectId;
  providerId: Types.ObjectId;
  paymentId: Types.ObjectId | null;
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

export const FLIGHT_ROW: Record<string, unknown> = {
  type: { $literal: BookingType.Flight },
  reference: 1,
  status: 1,
  userId: 1,
  providerId: { $arrayElemAt: ['$segments.airlineId', 0] },
  paymentId: 1,
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

export const HOTEL_ROW: Record<string, unknown> = {
  type: { $literal: BookingType.Hotel },
  reference: 1,
  status: 1,
  userId: 1,
  providerId: '$hotelId',
  paymentId: 1,
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

/**
 * ACC-17 travel-date filter, shared by the admin list and the analytics (BON-01): a trip matches when it
 * overlaps from..to, in UTC calendar days, both ends included.
 */
export function travelRangeMatch(
  from?: string,
  to?: string,
): Record<string, unknown> {
  const match: Record<string, unknown> = {};
  if (from) match.endsAt = { $gt: new Date(`${from}T00:00:00Z`) };
  if (to) match.startsAt = { $lt: new Date(`${addDays(to, 1)}T00:00:00Z`) };
  return match;
}

/**
 * The flight rows and the hotel rows matching `match` as one stream ($unionWith), followed by `tail`.
 * `onHotels` says which collection to run the pipeline on: hotel_reservations when only hotels are
 * wanted, otherwise flight_bookings (which unions the hotels in when both are wanted).
 */
export function bookingRowsPipeline(
  type: BookingType | undefined,
  match: Record<string, unknown>,
  tail: PipelineStage[],
): { onHotels: boolean; pipeline: PipelineStage[] } {
  const rowsOf = (shape: Record<string, unknown>): PipelineStage[] => [
    { $match: match },
    { $project: shape },
  ];
  if (type === BookingType.Hotel) {
    return { onHotels: true, pipeline: [...rowsOf(HOTEL_ROW), ...tail] };
  }
  if (type === BookingType.Flight) {
    return { onHotels: false, pipeline: [...rowsOf(FLIGHT_ROW), ...tail] };
  }
  return {
    onHotels: false,
    pipeline: [
      ...rowsOf(FLIGHT_ROW),
      {
        $unionWith: {
          coll: HOTEL_RESERVATIONS_COLLECTION,
          pipeline: rowsOf(HOTEL_ROW),
        },
      } as PipelineStage,
      ...tail,
    ],
  };
}

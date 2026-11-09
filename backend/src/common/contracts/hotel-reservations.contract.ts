import type { IsoDate } from '../utils/dates';
import type { MinorUnits } from '../utils/money';
import type { BookingStatus } from './booking.contract';

/**
 * Contract 10 - HotelReservationsReader (Karim -> Sandra).
 *
 * The hotels module needs to read reservations (HTL-22 moderator view,
 * HTL-23 "only a Completed reservation can be reviewed") without importing
 * Karim's module. Until the real provider lands, `HotelReservationsStub`
 * is bound to the token.
 */

export interface HotelReservationRoomView {
  roomId: string;
  adults: number;
  /** Ages 0-17. */
  children: number[];
  nightlyPriceMinor: MinorUnits;
}

export interface HotelReservationView {
  id: string;
  userId: string;
  hotelId: string;
  reference: string | null;
  status: BookingStatus;
  checkIn: IsoDate;
  checkOut: IsoDate;
  rooms: HotelReservationRoomView[];
  totalMinor: MinorUnits;
  createdAt: Date;
}

export interface HotelReservationsPage {
  items: HotelReservationView[];
  total: number;
}

export interface HotelReservationsReader {
  /** Null when the reservation does not exist. */
  getById(id: string): Promise<HotelReservationView | null>;

  /** Newest first. `page` is 1-based. */
  listForHotel(
    hotelId: string,
    page: number,
    limit: number,
  ): Promise<HotelReservationsPage>;
}

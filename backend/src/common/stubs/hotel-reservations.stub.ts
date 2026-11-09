import { Injectable } from '@nestjs/common';
import {
  HotelReservationsPage,
  HotelReservationsReader,
  HotelReservationView,
} from '../contracts/hotel-reservations.contract';

/**
 * Stand-in for Karim's hotel reservations (contract 10). Empty by default;
 * tests and demos seed it with `add()`.
 */
@Injectable()
export class HotelReservationsStub implements HotelReservationsReader {
  private readonly items = new Map<string, HotelReservationView>();

  add(reservation: HotelReservationView): void {
    this.items.set(reservation.id, reservation);
  }

  clear(): void {
    this.items.clear();
  }

  getById(id: string): Promise<HotelReservationView | null> {
    return Promise.resolve(this.items.get(id) ?? null);
  }

  listForHotel(
    hotelId: string,
    page: number,
    limit: number,
  ): Promise<HotelReservationsPage> {
    const all = [...this.items.values()]
      .filter((r) => r.hotelId === hotelId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (Math.max(1, page) - 1) * limit;
    return Promise.resolve({
      items: all.slice(start, start + limit),
      total: all.length,
    });
  }
}

import 'server-only';
import { serverApi } from '@/shared/api/server';
import type { HotelSelection } from '../model/rooms';

/** A selected room as the hotel details form needs it (serialisable for the client). */
export type StayRoom = {
  roomId: string;
  number: string;
  type: string;
  beds: number;
  maxOccupancy: number;
  priceMinor: number;
  stayTotalMinor: number | null;
  /** false when the room is no longer free for every night of the stay (booked, held or blocked). */
  available: boolean;
};

export type HotelStay = {
  hotelId: string;
  hotelName: string;
  address: string;
  photo: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: StayRoom[];
};

export type StayResult =
  { ok: true; stay: HotelStay } | { ok: false; reason: string };

/**
 * Loads the hotel with the stay dates from the public GET /api/hotels/:id (HTL-02, HTL-15): with
 * dates it lists only the rooms free for every night, with their stay totals. A selected room that is
 * missing from that list is kept but marked unavailable, so the traveller can remove it.
 */
export async function loadHotelStay(
  selection: HotelSelection,
): Promise<StayResult> {
  const api = await serverApi();
  const { data, error } = await api.GET('/api/hotels/{id}', {
    params: {
      path: { id: selection.hotelId },
      query: { checkIn: selection.checkIn, checkOut: selection.checkOut },
    },
  });
  if (!data) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : 'The hotel could not be loaded.';
    return { ok: false, reason: message };
  }
  if (!data.hotel.isActive)
    return { ok: false, reason: `${data.hotel.name} is not taking bookings.` };

  // Rooms not free for the dates are absent from `data.rooms`; look them up without dates for details.
  const free = new Map(data.rooms.map((r) => [r.id, r]));
  const missing = selection.rooms.some((r) => !free.has(r.roomId));
  const allRooms = missing
    ? ((
        await api.GET('/api/hotels/{id}', {
          params: { path: { id: selection.hotelId } },
        })
      ).data?.rooms ?? [])
    : [];
  const known = new Map(allRooms.map((r) => [r.id, r]));

  const rooms: StayRoom[] = [];
  for (const { roomId } of selection.rooms) {
    const room = free.get(roomId) ?? known.get(roomId);
    if (!room)
      return {
        ok: false,
        reason: 'A selected room is not part of this hotel.',
      };
    rooms.push({
      roomId,
      number: room.number,
      type: room.type,
      beds: room.beds,
      maxOccupancy: room.maxOccupancy,
      priceMinor: room.priceMinor,
      stayTotalMinor: free.get(roomId)?.stayTotalMinor ?? null,
      available: free.has(roomId),
    });
  }

  return {
    ok: true,
    stay: {
      hotelId: data.hotel.id,
      hotelName: data.hotel.name,
      address: data.hotel.address,
      photo: data.hotel.photos[0] ?? null,
      checkInTime: data.hotel.checkInTime,
      checkOutTime: data.hotel.checkOutTime,
      checkIn: selection.checkIn,
      checkOut: selection.checkOut,
      nights: data.stay?.nights ?? 0,
      rooms,
    },
  };
}

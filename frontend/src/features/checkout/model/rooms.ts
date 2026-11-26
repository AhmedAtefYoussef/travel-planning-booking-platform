/**
 * Hotel checkout details (HTL-16, HTL-17): the stay that hotel search hands over in the URL, the guest
 * rules the API enforces (mirrored only to help the user, GEN-13), and the body for POST
 * /hotel-bookings. Pure: no React, no fetch.
 */
import { z } from 'zod';
import { nightsBetween } from '@/shared/lib/dates';
import { isRealDate } from './passengers';

export const MAX_NIGHTS = 30;
export const MAX_ROOMS = 10;
export const MAX_ADULTS_PER_ROOM = 20;
export const MAX_CHILDREN_PER_ROOM = 20;
/** Older guests count as adults (backend MAX_CHILD_AGE). */
export const MAX_CHILD_AGE = 17;

const MONGO_ID = /^[a-f0-9]{24}$/i;

export type RoomGuests = {
  roomId: string;
  adults: number;
  childrenAges: number[];
};

export type HotelSelection = {
  hotelId: string;
  checkIn: string;
  checkOut: string;
  rooms: RoomGuests[];
};

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function all(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).filter(Boolean);
}

// Shared with hotel search and the moderator calendar (GEN-16 date helpers).
export { nightsBetween };

const WHOLE = /^\d{1,2}$/;

/** `<roomId>:<adults>:<age,age>`; the ages part may be empty or left out. */
function parseRoom(value: string): RoomGuests | null {
  const [roomId, adultsRaw = '1', agesRaw = '', extra] = value.split(':');
  if (extra !== undefined || !MONGO_ID.test(roomId ?? '')) return null;
  if (!WHOLE.test(adultsRaw)) return null;
  const ages = agesRaw === '' ? [] : agesRaw.split(',');
  if (ages.some((a) => !WHOLE.test(a))) return null;
  return { roomId, adults: Number(adultsRaw), childrenAges: ages.map(Number) };
}

export type HotelSelectionResult =
  { ok: true; selection: HotelSelection } | { ok: false; reason: string };

/**
 * /checkout/hotel?hotelId=&checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD&rooms=<roomId>:<adults>:<ages>
 * (`rooms` repeats once per room; the entry contract FE-08 links to).
 */
export function parseHotelSelection(
  params: SearchParams,
): HotelSelectionResult {
  const hotelId = one(params.hotelId) ?? '';
  if (!MONGO_ID.test(hotelId))
    return { ok: false, reason: 'The selected hotel is missing.' };
  const checkIn = one(params.checkIn) ?? '';
  const checkOut = one(params.checkOut) ?? '';
  if (!isRealDate(checkIn) || !isRealDate(checkOut))
    return { ok: false, reason: 'The stay dates are missing or not valid.' };
  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1)
    return { ok: false, reason: 'Check-out must be after check-in.' };
  if (nights > MAX_NIGHTS)
    return { ok: false, reason: `A stay can be at most ${MAX_NIGHTS} nights.` };

  const raw = all(params.rooms);
  if (raw.length === 0) return { ok: false, reason: 'No room was selected.' };
  if (raw.length > MAX_ROOMS)
    return {
      ok: false,
      reason: `At most ${MAX_ROOMS} rooms can be booked together.`,
    };
  const rooms: RoomGuests[] = [];
  for (const value of raw) {
    const room = parseRoom(value);
    if (!room) return { ok: false, reason: 'A selected room is not valid.' };
    if (rooms.some((r) => r.roomId === room.roomId))
      return { ok: false, reason: 'The same room was selected twice.' };
    rooms.push(room);
  }
  return { ok: true, selection: { hotelId, checkIn, checkOut, rooms } };
}

/** Why a room's guests cannot stay in it, or null (API: at least one guest, within maxOccupancy). */
export function roomGuestsError(
  guests: { adults: number; childrenAges: readonly number[] },
  maxOccupancy: number,
): string | null {
  const total = guests.adults + guests.childrenAges.length;
  if (total < 1) return 'Add at least one guest to this room.';
  if (total > maxOccupancy)
    return `This room sleeps at most ${maxOccupancy} guest${maxOccupancy === 1 ? '' : 's'}.`;
  return null;
}

/** The API needs at least one adult across the whole reservation. */
export function hasAdult(rooms: readonly { adults: number }[]): boolean {
  return rooms.some((r) => r.adults > 0);
}

/** Sum of the rooms' stay totals (minor units); null when any total is unknown. */
export function stayTotal(
  rooms: readonly { stayTotalMinor: number | null }[],
): number | null {
  let sum = 0;
  for (const r of rooms) {
    if (r.stayTotalMinor === null) return null;
    sum += r.stayTotalMinor;
  }
  return sum;
}

/** Form schema for the guests of each selected room, in the order of `maxOccupancies`. */
export function roomsFormSchema(maxOccupancies: readonly number[]) {
  const room = z.object({
    adults: z
      .number({ error: 'Choose the number of adults.' })
      .int()
      .min(0)
      .max(
        MAX_ADULTS_PER_ROOM,
        `At most ${MAX_ADULTS_PER_ROOM} adults per room.`,
      ),
    childrenAges: z
      .array(
        z
          .number({ error: 'Choose the child’s age.' })
          .int()
          .min(0, 'Choose the child’s age.')
          .max(
            MAX_CHILD_AGE,
            `Children are 0 to ${MAX_CHILD_AGE}; older guests are adults.`,
          ),
      )
      .max(MAX_CHILDREN_PER_ROOM),
  });
  return z
    .object({ rooms: z.array(room).min(1).max(MAX_ROOMS) })
    .superRefine(({ rooms }, ctx) => {
      rooms.forEach((r, i) => {
        const problem = roomGuestsError(r, maxOccupancies[i] ?? 0);
        if (problem)
          ctx.addIssue({
            code: 'custom',
            path: ['rooms', i],
            message: problem,
          });
      });
      if (!hasAdult(rooms))
        ctx.addIssue({
          code: 'custom',
          path: ['rooms'],
          message: 'At least one adult must stay in the reservation.',
        });
    });
}

export type RoomsFormValues = z.output<ReturnType<typeof roomsFormSchema>>;

export type HotelBookingBody = {
  hotelId: string;
  checkIn: string;
  checkOut: string;
  rooms: RoomGuests[];
};

/** The body for POST /hotel-bookings (the hold), rooms in the same order as the form. */
export function toHotelBody(
  selection: Pick<HotelSelection, 'hotelId' | 'checkIn' | 'checkOut'>,
  roomIds: readonly string[],
  values: RoomsFormValues,
): HotelBookingBody {
  return {
    hotelId: selection.hotelId,
    checkIn: selection.checkIn,
    checkOut: selection.checkOut,
    rooms: values.rooms.map((r, i) => ({
      roomId: roomIds[i],
      adults: r.adults,
      childrenAges: [...r.childrenAges],
    })),
  };
}

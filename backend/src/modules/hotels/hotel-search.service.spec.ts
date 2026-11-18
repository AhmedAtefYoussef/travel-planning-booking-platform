import { Types } from 'mongoose';
import type { FreeRoom } from './hotel-details.service';
import { cheapestFit } from './hotel-search.service';

const room = (maxOccupancy: number, priceMinor = 1000): FreeRoom => ({
  _id: new Types.ObjectId(),
  hotelId: new Types.ObjectId(),
  number: String(maxOccupancy),
  type: 'Room',
  beds: 1,
  maxOccupancy,
  priceMinor,
  availability: [],
});
const fits = (free: FreeRoom[], rooms: number, guests: number) =>
  cheapestFit(free, rooms, guests) !== null;

describe('hotel search room fit (HTL-11)', () => {
  it('needs at least as many free rooms as requested', () => {
    expect(fits([room(4)], 2, 2)).toBe(false);
    expect(fits([room(1), room(1)], 2, 2)).toBe(true);
  });

  it('the chosen rooms together must hold the guests', () => {
    const free = [room(2), room(1), room(4)];
    expect(fits(free, 1, 4)).toBe(true);
    expect(fits(free, 1, 5)).toBe(false);
    expect(fits(free, 2, 6)).toBe(true);
    expect(fits(free, 2, 7)).toBe(false);
    expect(fits(free, 3, 7)).toBe(true);
  });

  it('never fits more rooms than guests, or no free rooms', () => {
    expect(fits([room(2), room(2)], 2, 1)).toBe(false);
    expect(fits([], 1, 1)).toBe(false);
  });
});

describe('hotel search "from" price (HTL-11, HTL-12)', () => {
  it('is the cheapest room that holds all the guests, not the cheapest room', () => {
    const free = [room(1, 6000), room(2, 9000), room(4, 25000)];
    expect(cheapestFit(free, 1, 1)).toBe(6000);
    expect(cheapestFit(free, 1, 2)).toBe(9000);
    expect(cheapestFit(free, 1, 4)).toBe(25000);
  });

  it('for several rooms, the cheapest set that holds the guests together', () => {
    const free = [room(1, 6000), room(2, 9000), room(2, 9500), room(4, 25000)];
    // 2 + 2 is cheaper than 4 + 1 for four guests in two rooms.
    expect(cheapestFit(free, 2, 4)).toBe(18500);
    // Three guests: a single and a double.
    expect(cheapestFit(free, 2, 3)).toBe(15000);
    // Each room counts once: five guests need the 4-person room and one more.
    expect(cheapestFit(free, 2, 5)).toBe(31000);
    expect(cheapestFit(free, 2, 7)).toBeNull();
  });
});

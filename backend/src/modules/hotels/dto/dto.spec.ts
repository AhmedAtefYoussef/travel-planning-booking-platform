import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateHotelDto, PutPoliciesDto } from './hotel.dto';
import { CreateRoomDto, DateRangeDto } from './room.dto';
import { HotelSearchDto } from './search.dto';
import { CreateReviewDto } from './review.dto';

async function errorsOf<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property).sort();
}

const hotel = {
  name: 'Nile View',
  address: '12 Corniche',
  cityId: 'cairo',
  countryCode: 'eg',
};

describe('hotel DTOs', () => {
  it('accepts a minimal hotel and upper-cases the country', async () => {
    expect(await errorsOf(CreateHotelDto, hotel)).toEqual([]);
    expect(plainToInstance(CreateHotelDto, hotel).countryCode).toBe('EG');
  });

  it('rejects bad hotel fields', async () => {
    expect(
      await errorsOf(CreateHotelDto, {
        ...hotel,
        name: '   ',
        cityId: 'Cairo City',
        countryCode: 'EGY',
        starClass: 6,
        amenities: ['WiFi', 'WiFi'],
      }),
    ).toEqual(['amenities', 'cityId', 'countryCode', 'name', 'starClass']);
  });

  it('rejects unknown fields', async () => {
    expect(await errorsOf(CreateHotelDto, { ...hotel, ratingAvg: 5 })).toEqual([
      'ratingAvg',
    ]);
  });

  it('validates policy times and tiers', async () => {
    const good = {
      checkInTime: '14:00',
      checkOutTime: '11:30',
      tiers: [{ daysBefore: 7, refundPercent: 50 }],
    };
    expect(await errorsOf(PutPoliciesDto, good)).toEqual([]);
    expect(
      await errorsOf(PutPoliciesDto, { ...good, checkInTime: '24:00' }),
    ).toEqual(['checkInTime']);
    expect(
      await errorsOf(PutPoliciesDto, { ...good, checkOutTime: '9:5' }),
    ).toEqual(['checkOutTime']);
    expect(
      await errorsOf(PutPoliciesDto, {
        ...good,
        tiers: [{ daysBefore: -1, refundPercent: 101 }],
      }),
    ).toEqual(['tiers']);
  });
});

describe('room DTOs', () => {
  const room = {
    number: '101',
    type: 'Double',
    beds: 2,
    maxOccupancy: 3,
    priceMinor: 12000,
  };

  it('accepts a valid room', async () => {
    expect(await errorsOf(CreateRoomDto, room)).toEqual([]);
  });

  it('requires occupancy >= 1, a positive price and integer values', async () => {
    expect(await errorsOf(CreateRoomDto, { ...room, maxOccupancy: 0 })).toEqual(
      ['maxOccupancy'],
    );
    expect(await errorsOf(CreateRoomDto, { ...room, priceMinor: 0 })).toEqual([
      'priceMinor',
    ]);
    expect(
      await errorsOf(CreateRoomDto, { ...room, priceMinor: 99.5 }),
    ).toEqual(['priceMinor']);
    expect(await errorsOf(CreateRoomDto, { ...room, beds: 1.5 })).toEqual([
      'beds',
    ]);
  });

  it('rejects impossible calendar dates in ranges', async () => {
    expect(
      await errorsOf(DateRangeDto, { from: '2026-02-30', to: '2026-03-01' }),
    ).toEqual(['from']);
    expect(
      await errorsOf(DateRangeDto, {
        from: '2026-12-01T00:00:00Z',
        to: '2026-12-05',
      }),
    ).toEqual(['from']);
  });
});

describe('search and review DTOs', () => {
  const search = {
    cityId: 'cairo',
    checkIn: '2026-12-10',
    checkOut: '2026-12-12',
    guests: '2',
  };

  it('coerces query strings and defaults rooms and sort', async () => {
    const dto = plainToInstance(HotelSearchDto, search);
    expect(await validate(dto)).toEqual([]);
    expect(dto.guests).toBe(2);
    expect(dto.rooms).toBe(1);
    expect(dto.sortBy).toBe('price');
    expect(dto.page).toBe(1);
  });

  it('rejects bad search values', async () => {
    expect(await errorsOf(HotelSearchDto, { ...search, guests: '0' })).toEqual([
      'guests',
    ]);
    expect(
      await errorsOf(HotelSearchDto, { ...search, sortBy: 'stars' }),
    ).toEqual(['sortBy']);
    expect(
      await errorsOf(HotelSearchDto, { ...search, minRating: '6' }),
    ).toEqual(['minRating']);
    expect(
      await errorsOf(HotelSearchDto, { ...search, checkIn: '10/12/2026' }),
    ).toEqual(['checkIn']);
  });

  it('limits review rating and text length', async () => {
    expect(await errorsOf(CreateReviewDto, { rating: 5 })).toEqual([]);
    expect(await errorsOf(CreateReviewDto, { rating: 0 })).toEqual(['rating']);
    expect(await errorsOf(CreateReviewDto, { rating: 3.5 })).toEqual([
      'rating',
    ]);
    expect(
      await errorsOf(CreateReviewDto, { rating: 4, text: 'x'.repeat(1001) }),
    ).toEqual(['text']);
    expect(
      await errorsOf(CreateReviewDto, { rating: 4, text: 'x'.repeat(1000) }),
    ).toEqual([]);
  });
});

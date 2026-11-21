import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateHotelDto, UpdateHotelDto } from './hotel.dto';

const valid = {
  name: 'Nile View Hotel',
  address: '12 Corniche El Nil',
  cityId: 'cairo',
};
const createFields = (body: object) =>
  validateSync(plainToInstance(CreateHotelDto, { ...valid, ...body })).map(
    (e) => e.property,
  );
const updateFields = (body: object) =>
  validateSync(plainToInstance(UpdateHotelDto, body)).map((e) => e.property);

describe('CreateHotelDto (HTL-01)', () => {
  it('accepts a minimal and a full profile', () => {
    expect(createFields({})).toEqual([]);
    expect(
      createFields({
        description: 'Riverside hotel',
        photos: ['https://cdn.example.com/a.jpg'],
        starClass: 5,
        amenities: ['WiFi', 'Pool'],
      }),
    ).toEqual([]);
  });

  it('rejects short names and addresses, and star classes outside 1-5', () => {
    expect(createFields({ name: 'N' })).toEqual(['name']);
    expect(createFields({ address: 'x' })).toEqual(['address']);
    expect(createFields({ starClass: 0 })).toEqual(['starClass']);
    expect(createFields({ starClass: 6 })).toEqual(['starClass']);
    expect(createFields({ starClass: 3.5 })).toEqual(['starClass']);
  });

  it('rejects whole numbers too large to count exactly (GEN-13)', () => {
    for (const starClass of [1e20, 1e300]) {
      expect(createFields({ starClass })).toEqual(['starClass']);
      expect(updateFields({ starClass })).toEqual(['starClass']);
    }
  });

  it('allows at most 5 photos, each an http(s) URL', () => {
    const url = 'https://cdn.example.com/p.jpg';
    expect(createFields({ photos: Array(5).fill(url) })).toEqual([]);
    expect(createFields({ photos: Array(6).fill(url) })).toEqual(['photos']);
    expect(createFields({ photos: ['not-a-url'] })).toEqual(['photos']);
    expect(createFields({ photos: ['ftp://host/p.jpg'] })).toEqual(['photos']);
  });

  it('trims amenities and drops blanks and repeats ignoring case', () => {
    const dto = plainToInstance(CreateHotelDto, {
      ...valid,
      amenities: [' WiFi ', 'wifi', '', 'Pool'],
    });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.amenities).toEqual(['WiFi', 'Pool']);
  });

  it('rejects more than 30 amenities and over-long ones', () => {
    expect(
      createFields({
        amenities: Array.from({ length: 31 }, (_, i) => `A${i}`),
      }),
    ).toEqual(['amenities']);
    expect(createFields({ amenities: ['x'.repeat(51)] })).toEqual([
      'amenities',
    ]);
  });
});

describe('UpdateHotelDto (HTL-01)', () => {
  it('lets every field be left out', () => {
    expect(updateFields({})).toEqual([]);
    expect(updateFields({ name: 'Nile View Grand' })).toEqual([]);
  });

  it('rejects null for every field', () => {
    expect(
      updateFields({
        name: null,
        address: null,
        cityId: null,
        description: null,
        photos: null,
        starClass: null,
        amenities: null,
      }).sort(),
    ).toEqual([
      'address',
      'amenities',
      'cityId',
      'description',
      'name',
      'photos',
      'starClass',
    ]);
  });

  it('still validates a field that is sent', () => {
    expect(updateFields({ starClass: 9 })).toEqual(['starClass']);
    expect(updateFields({ photos: ['nope'] })).toEqual(['photos']);
  });
});

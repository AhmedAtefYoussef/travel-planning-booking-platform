import { Types, type Model } from 'mongoose';
import { AuthUser, ProviderType, Role } from '../../common/auth/auth.types';
import type { ReferenceService } from '../../common/contracts/services.contract';
import { AppException } from '../../common/errors/app.exception';
import type { Hotel } from './hotel.schema';
import { HotelsService } from './hotels.service';

const hotelId = new Types.ObjectId();
const now = new Date('2026-11-09T10:00:00Z');

function fakeHotel(over: Record<string, unknown> = {}) {
  return {
    _id: hotelId,
    id: hotelId.toHexString(),
    name: 'Nile View Hotel',
    address: '12 Corniche El Nil',
    cityId: 'cairo',
    countryCode: 'EG',
    description: '',
    photos: [] as string[],
    starClass: undefined as number | undefined,
    amenities: [] as string[],
    active: true,
    createdAt: now,
    updatedAt: now,
    save: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

const CITIES: Record<string, { cityId: string; countryCode: string }> = {
  cairo: { cityId: 'cairo', countryCode: 'EG' },
  dubai: { cityId: 'dubai', countryCode: 'AE' },
};

function setup(found: ReturnType<typeof fakeHotel> | null) {
  const model = {
    findById: jest.fn(() => ({ exec: () => Promise.resolve(found) })),
    create: jest.fn((doc: object) =>
      Promise.resolve({ ...fakeHotel(), ...doc }),
    ),
  };
  const reference = {
    getCity: jest.fn((id: string) => Promise.resolve(CITIES[id] ?? null)),
  };
  return {
    model,
    reference,
    service: new HotelsService(
      model as unknown as Model<Hotel>,
      reference as unknown as ReferenceService,
    ),
  };
}

const moderatorOf = (id: string): AuthUser => ({
  id: new Types.ObjectId().toHexString(),
  role: Role.HotelModerator,
  assignedProvider: { type: ProviderType.Hotel, providerId: id },
});

describe('HotelsService (HTL-01)', () => {
  it('creates a hotel taking the country from the city', async () => {
    const { service, model } = setup(null);
    const dto = await service.create({
      name: 'Nile View Hotel',
      address: '12 Corniche El Nil',
      cityId: 'dubai',
      starClass: 4,
    });
    expect(model.create).toHaveBeenCalledWith({
      name: 'Nile View Hotel',
      address: '12 Corniche El Nil',
      cityId: 'dubai',
      countryCode: 'AE',
      description: '',
      photos: [],
      starClass: 4,
      amenities: [],
    });
    expect(dto).toMatchObject({
      countryCode: 'AE',
      starClass: 4,
      active: true,
    });
  });

  it('rejects an unknown city with 400 and creates nothing', async () => {
    const { service, model } = setup(null);
    await expect(
      service.create({ name: 'Hotel', address: 'Somewhere 1', cityId: 'nope' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(model.create).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown hotel', async () => {
    const { service } = setup(null);
    await expect(
      service.update(
        moderatorOf(hotelId.toHexString()),
        hotelId.toHexString(),
        {
          name: 'Another name',
        },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('lets the assigned moderator edit, saving only what was sent', async () => {
    const hotel = fakeHotel();
    const { service } = setup(hotel);
    const dto = await service.update(
      moderatorOf(hotelId.toHexString()),
      hotelId.toHexString(),
      { name: 'Nile View Grand', amenities: ['WiFi'] },
    );
    expect(hotel.name).toBe('Nile View Grand');
    expect(hotel.address).toBe('12 Corniche El Nil');
    expect(hotel.save).toHaveBeenCalledTimes(1);
    expect(dto).toMatchObject({ name: 'Nile View Grand', amenities: ['WiFi'] });
  });

  it('changes the country when the city changes, and not otherwise', async () => {
    const hotel = fakeHotel();
    const { service, reference } = setup(hotel);
    const user = moderatorOf(hotelId.toHexString());
    await service.update(user, hotelId.toHexString(), { cityId: 'cairo' });
    expect(reference.getCity).not.toHaveBeenCalled();
    await service.update(user, hotelId.toHexString(), { cityId: 'dubai' });
    expect(hotel).toMatchObject({ cityId: 'dubai', countryCode: 'AE' });
  });

  it('rejects an unknown new city without changing the hotel', async () => {
    const hotel = fakeHotel();
    const { service } = setup(hotel);
    await expect(
      service.update(
        moderatorOf(hotelId.toHexString()),
        hotelId.toHexString(),
        {
          cityId: 'nope',
        },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(hotel.cityId).toBe('cairo');
    expect(hotel.save).not.toHaveBeenCalled();
  });

  it('rejects an edit with no fields', async () => {
    const hotel = fakeHotel();
    const { service } = setup(hotel);
    await expect(
      service.update(
        moderatorOf(hotelId.toHexString()),
        hotelId.toHexString(),
        {},
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(hotel.save).not.toHaveBeenCalled();
  });

  it("refuses another hotel's moderator, an admin and a traveller with 403", async () => {
    const hotel = fakeHotel();
    const { service } = setup(hotel);
    const others: AuthUser[] = [
      moderatorOf(new Types.ObjectId().toHexString()),
      { id: new Types.ObjectId().toHexString(), role: Role.Admin },
      { id: new Types.ObjectId().toHexString(), role: Role.User },
    ];
    for (const user of others) {
      await expect(
        service.update(user, hotelId.toHexString(), { name: 'Hijacked' }),
      ).rejects.toBeInstanceOf(AppException);
    }
    expect(hotel.name).toBe('Nile View Hotel');
    expect(hotel.save).not.toHaveBeenCalled();
  });

  it('refuses edits to a deactivated hotel with 403', async () => {
    const hotel = fakeHotel({ active: false });
    const { service } = setup(hotel);
    await expect(
      service.update(
        moderatorOf(hotelId.toHexString()),
        hotelId.toHexString(),
        {
          name: 'New name',
        },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(hotel.save).not.toHaveBeenCalled();
  });
});

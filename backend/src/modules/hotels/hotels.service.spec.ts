import { Types, type Model } from 'mongoose';
import { AuthUser, ProviderType, Role } from '../../common/auth/auth.types';
import type { ReferenceService } from '../../common/contracts/services.contract';
import { HotelsService } from './hotels.service';
import type { Hotel } from './schemas/hotel.schema';

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
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}
type FakeHotel = ReturnType<typeof fakeHotel>;

const CITIES: Record<string, { cityId: string; countryCode: string }> = {
  cairo: { cityId: 'cairo', countryCode: 'EG' },
  dubai: { cityId: 'dubai', countryCode: 'AE' },
};

/** A one-hotel stand-in for the model: findOneAndUpdate applies $set only to an active hotel. */
function setup(stored: FakeHotel | null) {
  const model = {
    findById: jest.fn(() => ({ exec: () => Promise.resolve(stored) })),
    findOneAndUpdate: jest.fn(
      (
        filter: { isActive?: boolean },
        update: { $set: Record<string, unknown> },
      ) => ({
        exec: () => {
          if (!stored || stored.isActive !== filter.isActive) {
            return Promise.resolve(null);
          }
          Object.assign(stored, update.$set);
          return Promise.resolve(stored);
        },
      }),
    ),
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
const own = () => moderatorOf(hotelId.toHexString());
const id = hotelId.toHexString();

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
      isActive: true,
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
      service.update(own(), id, { name: 'Another name' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('lets the assigned moderator edit in one atomic update of an active hotel', async () => {
    const hotel = fakeHotel();
    const { service, model } = setup(hotel);
    const dto = await service.update(own(), id, {
      name: 'Nile View Grand',
      amenities: ['WiFi'],
    });
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id, isActive: true },
      { $set: { name: 'Nile View Grand', amenities: ['WiFi'] } },
      { new: true, runValidators: true },
    );
    expect(hotel.address).toBe('12 Corniche El Nil');
    expect(dto).toMatchObject({ name: 'Nile View Grand', amenities: ['WiFi'] });
  });

  it('sets the country from the new city', async () => {
    const hotel = fakeHotel();
    const { service } = setup(hotel);
    await service.update(own(), id, { cityId: 'dubai' });
    expect(hotel).toMatchObject({ cityId: 'dubai', countryCode: 'AE' });
  });

  it('rejects an unknown new city without changing the hotel', async () => {
    const hotel = fakeHotel();
    const { service, model } = setup(hotel);
    await expect(
      service.update(own(), id, { cityId: 'nope' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(hotel.cityId).toBe('cairo');
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects an edit with no fields', async () => {
    const { service, model } = setup(fakeHotel());
    await expect(service.update(own(), id, {})).rejects.toMatchObject({
      status: 400,
    });
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("refuses another hotel's moderator, an admin and a traveller with 403 before reading the hotel", async () => {
    const hotel = fakeHotel();
    const { service, model } = setup(hotel);
    const others: AuthUser[] = [
      moderatorOf(new Types.ObjectId().toHexString()),
      { id: new Types.ObjectId().toHexString(), role: Role.Admin },
      { id: new Types.ObjectId().toHexString(), role: Role.User },
    ];
    for (const user of others) {
      await expect(
        service.update(user, id, { name: 'Hijacked' }),
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(hotel.name).toBe('Nile View Hotel');
    expect(model.findById).not.toHaveBeenCalled();
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("gives another hotel's moderator the scope error, not the deactivated state (no leak)", async () => {
    const { service } = setup(fakeHotel({ isActive: false }));
    await expect(
      service.update(moderatorOf(new Types.ObjectId().toHexString()), id, {
        name: 'Probe',
      }),
    ).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('assigned') as string,
    });
  });

  it('refuses edits to a deactivated hotel with 403 and changes nothing', async () => {
    const hotel = fakeHotel({ isActive: false });
    const { service } = setup(hotel);
    await expect(
      service.update(own(), id, { name: 'New name' }),
    ).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('deactivated') as string,
    });
    expect(hotel.name).toBe('Nile View Hotel');
  });
});

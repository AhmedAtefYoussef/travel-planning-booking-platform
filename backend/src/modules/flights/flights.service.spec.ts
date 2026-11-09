import { Types, type Model } from 'mongoose';
import { AuthUser, ProviderType, Role } from '../../common/auth/auth.types';
import type { Airport, ReferenceService } from '../../common/contracts';
import { ValidationFailedException } from '../../common/errors/app.exception';
import type { AirlinesService } from './airlines.service';
import type { CreateFlightDto } from './dto/flight.dto';
import { FlightsService } from './flights.service';
import type { Flight } from './schemas/flight.schema';

const AIRPORTS: Record<string, Airport> = {
  CAI: {
    iataCode: 'CAI',
    name: 'Cairo',
    cityId: 'cairo',
    countryCode: 'EG',
    timeZone: 'Africa/Cairo',
  },
  DXB: {
    iataCode: 'DXB',
    name: 'Dubai',
    cityId: 'dubai',
    countryCode: 'AE',
    timeZone: 'Asia/Dubai',
  },
  LHR: {
    iataCode: 'LHR',
    name: 'Heathrow',
    cityId: 'london',
    countryCode: 'GB',
    timeZone: 'Europe/London',
  },
  JFK: {
    iataCode: 'JFK',
    name: 'JFK',
    cityId: 'new_york',
    countryCode: 'US',
    timeZone: 'America/New_York',
  },
};

const airlineId = new Types.ObjectId();
const moderator: AuthUser = {
  id: new Types.ObjectId().toHexString(),
  role: Role.AirlineModerator,
  assignedProvider: {
    type: ProviderType.Airline,
    providerId: airlineId.toHexString(),
  },
};
const NOW = new Date('2026-11-08T12:00:00Z');

function setup() {
  const created: object[] = [];
  const model = {
    create: jest.fn((doc: Record<string, unknown>) => {
      created.push(doc);
      const id = new Types.ObjectId();
      return Promise.resolve({
        ...doc,
        id: id.toHexString(),
        cabins: [],
        createdAt: NOW,
        updatedAt: NOW,
      });
    }),
  };
  const reference = {
    getAirport: jest.fn((code: string) =>
      Promise.resolve(AIRPORTS[code] ?? null),
    ),
  } as unknown as ReferenceService;
  const airlines = {
    loadActive: jest.fn(() => Promise.resolve({ _id: airlineId })),
  } as unknown as AirlinesService;
  const service = new FlightsService(
    model as unknown as Model<Flight>,
    reference,
    airlines,
  );
  return { service, model, created, airlines };
}

/** AirlinesService stub whose airline is active (ACC-15). */
const activeAirline = () =>
  ({
    loadActive: jest.fn(() =>
      Promise.resolve({ _id: airlineId, isActive: true }),
    ),
  }) as unknown as AirlinesService;

const base: CreateFlightDto = {
  flightNumber: 'MS777',
  from: 'CAI',
  to: 'DXB',
  departureLocal: '2026-12-01T14:30',
  arrivalLocal: '2026-12-01T18:45',
};

async function fieldErrors(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    if (e instanceof ValidationFailedException) return e.fieldErrors ?? [];
    throw e;
  }
  throw new Error('expected a validation failure');
}

describe('FlightsService.create (FLT-03, GEN-06)', () => {
  it("converts each airport's local time to UTC and returns both forms", async () => {
    const { service, created } = setup();
    const dto = await service.create(moderator, base, NOW);

    // Cairo is UTC+2 in December, Dubai UTC+4.
    expect(created[0]).toMatchObject({
      airlineId,
      from: 'CAI',
      to: 'DXB',
      departureUtc: new Date('2026-12-01T12:30:00Z'),
      arrivalUtc: new Date('2026-12-01T14:45:00Z'),
      departureLocalDate: '2026-12-01',
      status: 'SCHEDULED',
    });
    expect(dto.departure).toEqual({
      airport: 'CAI',
      timeZone: 'Africa/Cairo',
      utc: new Date('2026-12-01T12:30:00Z'),
      local: '2026-12-01T14:30:00.000+02:00',
    });
    expect(dto.arrival.local).toBe('2026-12-01T18:45:00.000+04:00');
    expect(dto.durationMinutes).toBe(135);
  });

  it('handles a westbound flight that lands earlier on the clock than it left', async () => {
    const { service } = setup();
    const dto = await service.create(
      moderator,
      {
        ...base,
        flightNumber: 'BA117',
        from: 'LHR',
        to: 'JFK',
        departureLocal: '2026-12-01T08:25',
        arrivalLocal: '2026-12-01T11:20',
      },
      NOW,
    );
    expect(dto.departure.utc).toEqual(new Date('2026-12-01T08:25:00Z'));
    expect(dto.arrival.utc).toEqual(new Date('2026-12-01T16:20:00Z'));
    expect(dto.arrival.local).toBe('2026-12-01T11:20:00.000-05:00');
    expect(dto.durationMinutes).toBe(475);
  });

  it('stores the departure date as the local date at the departure airport', async () => {
    const { service, created } = setup();
    // 00:30 in Dubai on 2 Dec is still 1 Dec in UTC; the local date is what matters (FLT-03, FLT-11).
    await service.create(
      moderator,
      {
        ...base,
        from: 'DXB',
        to: 'CAI',
        departureLocal: '2026-12-02T00:30',
        arrivalLocal: '2026-12-02T02:00',
      },
      NOW,
    );
    expect(created[0]).toMatchObject({
      departureUtc: new Date('2026-12-01T20:30:00Z'),
      departureLocalDate: '2026-12-02',
    });
  });

  it('rejects identical airports', async () => {
    const { service, model } = setup();
    expect(
      await fieldErrors(
        service.create(
          moderator,
          { ...base, to: 'CAI', arrivalLocal: '2026-12-01T16:30' },
          NOW,
        ),
      ),
    ).toEqual([
      { field: 'to', message: 'Departure and arrival airports must differ' },
    ]);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('rejects an arrival that is not after the departure when compared in UTC', async () => {
    const { service } = setup();
    // 17:00 Cairo = 15:00Z; 18:00 Dubai = 14:00Z. The local clock says later, UTC says earlier.
    expect(
      await fieldErrors(
        service.create(
          moderator,
          {
            ...base,
            departureLocal: '2026-12-01T17:00',
            arrivalLocal: '2026-12-01T18:00',
          },
          NOW,
        ),
      ),
    ).toEqual([
      {
        field: 'arrivalLocal',
        message: 'Arrival must be after departure (compared in UTC)',
      },
    ]);
  });

  it('rejects a departure in the past', async () => {
    const { service } = setup();
    expect(
      await fieldErrors(
        service.create(
          moderator,
          {
            ...base,
            departureLocal: '2026-11-08T13:00',
            arrivalLocal: '2026-11-08T18:00',
          },
          NOW,
        ),
      ),
    ).toEqual([
      { field: 'departureLocal', message: 'Departure must be in the future' },
    ]);
  });

  it('rejects airports that are not in the seeded list (FLT-02)', async () => {
    const { service } = setup();
    expect(
      await fieldErrors(
        service.create(moderator, { ...base, from: 'XXX', to: 'YYY' }, NOW),
      ),
    ).toEqual([
      {
        field: 'from',
        message: 'Unknown airport "XXX" (see GET /api/airports)',
      },
      { field: 'to', message: 'Unknown airport "YYY" (see GET /api/airports)' },
    ]);
  });

  it('rejects a local time skipped by a daylight-saving change, naming the field', async () => {
    const { service } = setup();
    // London jumps from 01:00 to 02:00 on 28 March 2027, so 01:30 never happens there.
    const errors = await fieldErrors(
      service.create(
        moderator,
        {
          ...base,
          from: 'LHR',
          to: 'DXB',
          departureLocal: '2027-03-28T01:30',
          arrivalLocal: '2027-03-28T12:00',
        },
        NOW,
      ),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('departureLocal');
    expect(errors[0].message).toContain('daylight-saving');
  });

  it("uses the moderator's assigned airline and refuses a caller without one", async () => {
    const { service, airlines } = setup();
    await service.create(moderator, base, NOW);
    expect(airlines.loadActive).toHaveBeenCalledWith(airlineId);
    const noAirline: AuthUser = {
      id: moderator.id,
      role: Role.AirlineModerator,
    };
    await expect(service.create(noAirline, base, NOW)).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('FlightsService cabins (FLT-04)', () => {
  const flightId = new Types.ObjectId();
  const cabinId = new Types.ObjectId();

  function setupCabins(
    overrides: { status?: string; airline?: Types.ObjectId } = {},
  ) {
    const flight = {
      _id: flightId,
      id: flightId.toHexString(),
      airlineId: overrides.airline ?? airlineId,
      flightNumber: 'MS777',
      from: 'CAI',
      to: 'DXB',
      departureUtc: new Date('2026-12-01T12:30:00Z'),
      arrivalUtc: new Date('2026-12-01T14:45:00Z'),
      departureLocalDate: '2026-12-01',
      status: overrides.status ?? 'SCHEDULED',
      cabins: [
        {
          _id: cabinId,
          class: 'ECONOMY',
          totalSeats: 100,
          seatsAvailable: 70,
          priceMinor: 25_000,
          freeBags: 1,
          maxKgPerBag: 23,
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    };
    const model = {
      findById: jest.fn(() => ({ exec: () => Promise.resolve(flight) })),
      findOneAndUpdate: jest.fn(() => ({
        exec: () => Promise.resolve(flight),
      })),
    };
    const reference = {
      getAirport: jest.fn((code: string) =>
        Promise.resolve(AIRPORTS[code] ?? null),
      ),
    } as unknown as ReferenceService;
    const service = new FlightsService(
      model as unknown as Model<Flight>,
      reference,
      activeAirline(),
    );
    return { service, model };
  }

  const economy = {
    class: 'ECONOMY' as const,
    totalSeats: 150,
    priceMinor: 25_000,
    freeBags: 1,
    maxKgPerBag: 23,
  };

  it('refuses a class the flight already has, before writing', async () => {
    const { service, model } = setupCabins();
    await expect(
      service.addCabin(moderator, flightId.toHexString(), economy),
    ).rejects.toMatchObject({
      status: 409,
    });
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('adds a new class with seatsAvailable equal to totalSeats, guarded against duplicates', async () => {
    const { service, model } = setupCabins();
    await service.addCabin(moderator, flightId.toHexString(), {
      ...economy,
      class: 'BUSINESS',
      totalSeats: 20,
    });
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: flightId,
        status: 'SCHEDULED',
        'cabins.class': { $ne: 'BUSINESS' },
      },
      {
        $push: {
          cabins: expect.objectContaining({
            class: 'BUSINESS',
            totalSeats: 20,
            seatsAvailable: 20,
          }) as unknown,
        },
      },
      { new: true, runValidators: true },
    );
  });

  it('refuses to drop totalSeats below the 30 seats already taken', async () => {
    const { service, model } = setupCabins();
    await expect(
      service.updateCabin(
        moderator,
        flightId.toHexString(),
        cabinId.toHexString(),
        { totalSeats: 29 },
      ),
    ).rejects.toMatchObject({
      status: 409,
      message:
        'Cannot reduce ECONOMY to 29 seats: 30 are already booked or held',
    });
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('applies a seat reduction as one conditional update that keeps seatsAvailable >= 0', async () => {
    const { service, model } = setupCabins();
    await service.updateCabin(
      moderator,
      flightId.toHexString(),
      cabinId.toHexString(),
      {
        totalSeats: 40,
        priceMinor: 27_500,
      },
    );
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: flightId,
        status: 'SCHEDULED',
        cabins: {
          $elemMatch: {
            _id: cabinId,
            totalSeats: 100,
            seatsAvailable: { $gte: 60 },
          },
        },
      },
      {
        $set: { 'cabins.$.priceMinor': 27_500, 'cabins.$.totalSeats': 40 },
        $inc: { 'cabins.$.seatsAvailable': -60 },
      },
      // Schema validators (safe integers, minimums) also run on the update, behind the DTO.
      { new: true, runValidators: true },
    );
  });

  it('treats the same seat count as no change', async () => {
    const { service, model } = setupCabins();
    const dto = await service.updateCabin(
      moderator,
      flightId.toHexString(),
      cabinId.toHexString(),
      {
        totalSeats: 100,
      },
    );
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    expect(dto.cabins[0]).toMatchObject({
      totalSeats: 100,
      seatsAvailable: 70,
    });
  });

  it("refuses changes to a deactivated airline's flights (ACC-15)", async () => {
    const { model } = setupCabins();
    const inactive = {
      loadActive: jest.fn(() =>
        Promise.reject(
          Object.assign(new Error('deactivated'), { status: 403 }),
        ),
      ),
    } as unknown as AirlinesService;
    const blocked = new FlightsService(
      model as unknown as Model<Flight>,
      {} as ReferenceService,
      inactive,
    );
    await expect(
      blocked.updateCabin(
        moderator,
        flightId.toHexString(),
        cabinId.toHexString(),
        {
          priceMinor: 1,
        },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects an empty edit, another airline, and a flight that is not Scheduled', async () => {
    await expect(
      setupCabins().service.updateCabin(
        moderator,
        flightId.toHexString(),
        cabinId.toHexString(),
        {},
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      setupCabins({ airline: new Types.ObjectId() }).service.addCabin(
        moderator,
        flightId.toHexString(),
        {
          ...economy,
          class: 'FIRST',
        },
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      setupCabins({ status: 'DEPARTED' }).service.addCabin(
        moderator,
        flightId.toHexString(),
        {
          ...economy,
          class: 'FIRST',
        },
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});

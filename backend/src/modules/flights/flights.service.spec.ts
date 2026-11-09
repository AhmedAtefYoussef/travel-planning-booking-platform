import { Types, type Model } from 'mongoose';
import { AuthUser, ProviderType, Role } from '../../common/auth/auth.types';
import type { Airport, ReferenceService } from '../../common/contracts';
import { ValidationFailedException } from '../../common/errors/app.exception';
import type { AirlinesService } from './airlines.service';
import type { CreateFlightDto } from './dto/flight.dto';
import type { FlightScheduleNotifier } from './flight-schedule-notifier';
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

const silentNotifier = () =>
  ({
    timesChanged: jest.fn(() => Promise.resolve(null)),
  }) as unknown as FlightScheduleNotifier;

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
    silentNotifier(),
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
    overrides: {
      status?: string;
      airline?: Types.ObjectId;
      departureUtc?: Date;
    } = {},
  ) {
    const flight = {
      _id: flightId,
      id: flightId.toHexString(),
      airlineId: overrides.airline ?? airlineId,
      flightNumber: 'MS777',
      from: 'CAI',
      to: 'DXB',
      departureUtc: overrides.departureUtc ?? new Date('2030-12-01T12:30:00Z'),
      arrivalUtc: new Date('2030-12-01T14:45:00Z'),
      departureLocalDate: '2030-12-01',
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
      silentNotifier(),
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
        departureUtc: { $gt: expect.any(Date) as Date },
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
        departureUtc: { $gt: expect.any(Date) as Date },
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
      { new: true },
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

  it('re-checks the departure in the write: a flight that departs mid-request gets the FLT-30 409', async () => {
    const { service, model } = setupCabins();
    // The read sees a future departure; by the time of the write it has passed, so the conditional
    // update matches nothing and the re-read shows the past departure.
    const flight = await model.findById().exec();
    const departed = { ...flight, departureUtc: new Date(Date.now() - 1000) };
    model.findById
      .mockReturnValueOnce({ exec: () => Promise.resolve(flight) })
      .mockReturnValueOnce({ exec: () => Promise.resolve(departed) });
    model.findOneAndUpdate.mockReturnValueOnce({
      exec: () => Promise.resolve(null as never),
    });
    await expect(
      service.updateCabin(
        moderator,
        flightId.toHexString(),
        cabinId.toHexString(),
        {
          priceMinor: 1,
        },
      ),
    ).rejects.toMatchObject({
      status: 409,
      message:
        'This flight has already departed and can no longer be changed (FLT-30)',
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
      silentNotifier(),
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

  it('refuses changes once the departure time has passed, even before the status job runs (FLT-30)', async () => {
    const { service, model } = setupCabins({
      departureUtc: new Date(Date.now() - 60_000),
    });
    await expect(
      service.updateCabin(
        moderator,
        flightId.toHexString(),
        cabinId.toHexString(),
        { priceMinor: 1 },
      ),
    ).rejects.toMatchObject({
      status: 409,
      message:
        'This flight has already departed and can no longer be changed (FLT-30)',
    });
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('FlightsService.details (FLT-17)', () => {
  const flightId = new Types.ObjectId();
  function detailsSetup(
    flightOverrides: { status?: string; departureUtc?: Date } = {},
    airlineOverrides: { isActive?: boolean; policy?: object } = {},
  ) {
    const flight = {
      id: flightId.toHexString(),
      airlineId,
      flightNumber: 'MS777',
      from: 'CAI',
      to: 'DXB',
      departureUtc: new Date('2030-12-01T12:30:00Z'),
      arrivalUtc: new Date('2030-12-01T14:45:00Z'),
      departureLocalDate: '2030-12-01',
      status: 'SCHEDULED',
      cabins: [
        {
          _id: new Types.ObjectId(),
          class: 'ECONOMY',
          totalSeats: 150,
          seatsAvailable: 120,
          priceMinor: 25000,
          freeBags: 1,
          maxKgPerBag: 23,
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
      ...flightOverrides,
    };
    const airline = {
      id: airlineId.toHexString(),
      name: 'EgyptAir',
      code: 'MS',
      logoUrl: undefined,
      isActive: true,
      policy: {
        cancellationTiers: [
          { daysBefore: 7, refundPercent: 50 },
          { daysBefore: 30, refundPercent: 100 },
        ],
        extraBaggage: { pricePerBagMinor: 4000, maxExtraBagsPerPassenger: 2 },
      },
      ...airlineOverrides,
    };
    const model = {
      findById: jest.fn((id: string) => ({
        exec: () => Promise.resolve(id === flight.id ? flight : null),
      })),
    };
    const reference = {
      getAirport: jest.fn((code: string) =>
        Promise.resolve(AIRPORTS[code] ?? null),
      ),
    } as unknown as ReferenceService;
    const airlines = {
      load: jest.fn(() => Promise.resolve(airline)),
    } as unknown as AirlinesService;
    return new FlightsService(
      model as unknown as Model<Flight>,
      reference,
      airlines,
      silentNotifier(),
    );
  }

  it('shows airline, local times, duration, cabins with seats left and baggage, and the policies', async () => {
    const dto = await detailsSetup().details(flightId.toHexString(), NOW);
    expect(dto).toMatchObject({
      flightNumber: 'MS777',
      airline: {
        id: airlineId.toHexString(),
        name: 'EgyptAir',
        code: 'MS',
        logoUrl: null,
        isActive: true,
      },
      departure: { airport: 'CAI', local: '2030-12-01T14:30:00.000+02:00' },
      arrival: { airport: 'DXB', local: '2030-12-01T18:45:00.000+04:00' },
      durationMinutes: 135,
      cabins: [
        {
          class: 'ECONOMY',
          priceMinor: 25000,
          seatsAvailable: 120,
          freeBags: 1,
          maxKgPerBag: 23,
        },
      ],
      extraBaggage: { pricePerBagMinor: 4000, maxExtraBagsPerPassenger: 2 },
      cancellationTiers: [
        { daysBefore: 7, refundPercent: 50 },
        { daysBefore: 30, refundPercent: 100 },
      ],
      bookable: true,
    });
  });

  it('shows no extra-baggage policy and no tiers when the airline has none', async () => {
    const dto = await detailsSetup(
      {},
      { policy: { cancellationTiers: [] } },
    ).details(flightId.toHexString(), NOW);
    expect(dto.extraBaggage).toBeNull();
    expect(dto.cancellationTiers).toEqual([]);
  });

  it.each([
    ['Cancelled', { status: 'CANCELLED' }, {}],
    ['Departed', { status: 'DEPARTED' }, {}],
    [
      'past departure time',
      { departureUtc: new Date('2026-11-08T11:00:00Z') },
      {},
    ],
    ['deactivated airline', {}, { isActive: false }],
  ])('is not bookable: %s', async (_label, flight, airline) => {
    const dto = await detailsSetup(flight, airline).details(
      flightId.toHexString(),
      NOW,
    );
    expect(dto.bookable).toBe(false);
  });

  it('returns 404 for an unknown flight', async () => {
    await expect(
      detailsSetup().details(new Types.ObjectId().toHexString(), NOW),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('FlightsService.update (FLT-05)', () => {
  const flightId = new Types.ObjectId();

  function updateSetup(
    cabins: { totalSeats: number; seatsAvailable: number }[] = [],
  ) {
    const flight = {
      _id: flightId,
      id: flightId.toHexString(),
      airlineId,
      flightNumber: 'MS777',
      from: 'CAI',
      to: 'DXB',
      // Cairo 14:30 (UTC+2) -> Dubai 18:45 (UTC+4) on 1 Dec 2030.
      departureUtc: new Date('2030-12-01T12:30:00Z'),
      arrivalUtc: new Date('2030-12-01T14:45:00Z'),
      departureLocalDate: '2030-12-01',
      status: 'SCHEDULED',
      cabins: cabins.map((c) => ({
        _id: new Types.ObjectId(),
        class: 'ECONOMY',
        priceMinor: 1000,
        freeBags: 1,
        maxKgPerBag: 23,
        ...c,
      })),
      createdAt: NOW,
      updatedAt: NOW,
    };
    const findOneAndUpdate = jest.fn(
      (_filter: object, update: { $set: Record<string, unknown> }) => ({
        exec: () => Promise.resolve({ ...flight, ...update.$set }),
      }),
    );
    const model = {
      findById: jest.fn(() => ({ exec: () => Promise.resolve(flight) })),
      findOneAndUpdate,
    };
    const reference = {
      getAirport: jest.fn((code: string) =>
        Promise.resolve(AIRPORTS[code] ?? null),
      ),
    } as unknown as ReferenceService;
    const timesChanged = jest.fn(() => Promise.resolve(1));
    const service = new FlightsService(
      model as unknown as Model<Flight>,
      reference,
      activeAirline(),
      { timesChanged } as unknown as FlightScheduleNotifier,
    );
    return { service, findOneAndUpdate, timesChanged };
  }

  it('changes the times in local time, saves UTC and the new local date, and notifies', async () => {
    const { service, findOneAndUpdate, timesChanged } = updateSetup();
    const dto = await service.update(
      moderator,
      flightId.toHexString(),
      { departureLocal: '2030-12-02T01:00', arrivalLocal: '2030-12-02T05:15' },
      NOW,
    );
    const [filter, update] = findOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({
      _id: flightId,
      status: 'SCHEDULED',
      departureUtc: new Date('2030-12-01T12:30:00Z'),
    });
    expect(filter).not.toHaveProperty('$expr');
    expect(update.$set).toEqual({
      from: 'CAI',
      to: 'DXB',
      departureUtc: new Date('2030-12-01T23:00:00Z'),
      arrivalUtc: new Date('2030-12-02T01:15:00Z'),
      departureLocalDate: '2030-12-02',
    });
    expect(dto.departure.local).toBe('2030-12-02T01:00:00.000+02:00');
    expect(timesChanged).toHaveBeenCalledWith({
      flightId: flightId.toHexString(),
      flightNumber: 'MS777',
      from: 'CAI',
      to: 'DXB',
      departureLocal: '2030-12-02T01:00:00.000+02:00',
      arrivalLocal: '2030-12-02T05:15:00.000+04:00',
    });
  });

  it('keeps the local time of a field that is not sent', async () => {
    const { service, findOneAndUpdate } = updateSetup();
    await service.update(
      moderator,
      flightId.toHexString(),
      { arrivalLocal: '2030-12-01T19:30' },
      NOW,
    );
    expect(findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({
      departureUtc: new Date('2030-12-01T12:30:00Z'),
      arrivalUtc: new Date('2030-12-01T15:30:00Z'),
    });
  });

  it('lets airports change while nothing is booked, guarded in the database, without notifying', async () => {
    const { service, findOneAndUpdate, timesChanged } = updateSetup([
      { totalSeats: 100, seatsAvailable: 100 },
    ]);
    // New arrival airport, same local wall-clock time: London 18:45 (UTC+0 in December).
    await service.update(moderator, flightId.toHexString(), { to: 'LHR' }, NOW);
    const [filter, update] = findOneAndUpdate.mock.calls[0];
    expect(filter).toHaveProperty('$expr');
    expect(update.$set).toMatchObject({
      to: 'LHR',
      arrivalUtc: new Date('2030-12-01T18:45:00Z'),
    });
    expect(timesChanged).toHaveBeenCalled();
  });

  it('refuses to change airports once any seat is booked or held', async () => {
    const { service, findOneAndUpdate } = updateSetup([
      { totalSeats: 100, seatsAvailable: 97 },
    ]);
    await expect(
      service.update(moderator, flightId.toHexString(), { from: 'LHR' }, NOW),
    ).rejects.toMatchObject({
      status: 409,
      message:
        'Airports cannot be changed once the flight has bookings (3 seat(s) booked or held) (FLT-05)',
    });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('still allows time changes when seats are booked', async () => {
    const { service, findOneAndUpdate } = updateSetup([
      { totalSeats: 100, seatsAvailable: 50 },
    ]);
    await service.update(
      moderator,
      flightId.toHexString(),
      { departureLocal: '2030-12-01T15:00' },
      NOW,
    );
    expect(findOneAndUpdate).toHaveBeenCalled();
  });

  it('validates like creating a flight', async () => {
    const { service } = updateSetup();
    const id = flightId.toHexString();
    expect(
      (
        await fieldErrors(
          service.update(
            moderator,
            id,
            { arrivalLocal: '2030-12-01T13:00' },
            NOW,
          ),
        )
      ).map((e) => e.field),
    ).toEqual(['arrivalLocal']);
    expect(
      (
        await fieldErrors(service.update(moderator, id, { to: 'CAI' }, NOW))
      ).map((e) => e.field),
    ).toEqual(['to']);
    expect(
      (
        await fieldErrors(service.update(moderator, id, { from: 'XXX' }, NOW))
      ).map((e) => e.field),
    ).toEqual(['from']);
    expect(
      (
        await fieldErrors(
          service.update(
            moderator,
            id,
            { departureLocal: '2026-11-01T10:00' },
            NOW,
          ),
        )
      ).map((e) => e.field),
    ).toContain('departureLocal');
  });

  it('rejects an empty edit; an unchanged edit saves and notifies nothing', async () => {
    const { service, findOneAndUpdate, timesChanged } = updateSetup();
    await expect(
      service.update(moderator, flightId.toHexString(), {}, NOW),
    ).rejects.toMatchObject({ status: 400 });
    await service.update(
      moderator,
      flightId.toHexString(),
      { departureLocal: '2030-12-01T14:30' },
      NOW,
    );
    expect(findOneAndUpdate).not.toHaveBeenCalled();
    expect(timesChanged).not.toHaveBeenCalled();
  });
});

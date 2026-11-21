import mongoose, { Types } from 'mongoose';
import { AirlineSchema } from './airline.schema';
import { FlightSchema, FlightStatus } from './flight.schema';

// Models on a connection that is never opened: validateSync() runs the schema rules without a database.
const conn = mongoose.createConnection();
const AirlineModel = conn.model('AirlineSpec', AirlineSchema);
const FlightModel = conn.model('FlightSpec', FlightSchema);

const economy = {
  class: 'ECONOMY',
  totalSeats: 150,
  seatsAvailable: 150,
  priceMinor: 25_000,
  freeBags: 1,
  maxKgPerBag: 23,
};

function flight(overrides: Record<string, unknown> = {}) {
  return new FlightModel({
    airlineId: new Types.ObjectId(),
    flightNumber: 'ms777',
    from: 'CAI',
    to: 'DXB',
    departureUtc: new Date('2026-12-01T12:00:00Z'),
    arrivalUtc: new Date('2026-12-01T15:30:00Z'),
    departureLocalDate: '2026-12-01',
    cabins: [economy],
    ...overrides,
  });
}

function errorPaths(doc: mongoose.Document): string[] {
  return Object.keys(doc.validateSync()?.errors ?? {});
}

describe('flights schema (TRVL-138)', () => {
  it('accepts a valid flight, upper-cases the flight number and defaults to SCHEDULED', () => {
    const doc = flight();
    expect(errorPaths(doc)).toEqual([]);
    expect(doc.flightNumber).toBe('MS777');
    expect(doc.status).toBe(FlightStatus.Scheduled);
    expect(doc.cabins[0]._id).toBeInstanceOf(Types.ObjectId);
  });

  it('rejects identical departure and arrival airports (FLT-03)', () => {
    expect(errorPaths(flight({ to: 'CAI' }))).toEqual(['to']);
  });

  it('rejects an arrival that is not after the departure (FLT-03)', () => {
    expect(
      errorPaths(flight({ arrivalUtc: new Date('2026-12-01T12:00:00Z') })),
    ).toEqual(['arrivalUtc']);
  });

  it('rejects airports that are not IATA codes and malformed local dates', () => {
    expect(
      errorPaths(
        flight({ from: 'cairo', departureLocalDate: '01/12/2026' }),
      ).sort(),
    ).toEqual(['departureLocalDate', 'from']);
  });

  it('allows each cabin class at most once per flight (FLT-04)', () => {
    expect(errorPaths(flight({ cabins: [economy, { ...economy }] }))).toEqual([
      'cabins',
    ]);
  });

  it('only allows the fixed cabin set (FLT-04)', () => {
    expect(
      errorPaths(flight({ cabins: [{ ...economy, class: 'LUXURY' }] })),
    ).toEqual(['cabins.0.class']);
  });

  it('requires whole, positive seat counts and prices (FLT-04, PAY-04)', () => {
    const paths = errorPaths(
      flight({
        cabins: [
          { ...economy, totalSeats: 0, seatsAvailable: 1.5, priceMinor: 0 },
        ],
      }),
    ).sort();
    expect(paths).toEqual([
      'cabins.0.priceMinor',
      'cabins.0.seatsAvailable',
      'cabins.0.totalSeats',
    ]);
  });

  it('never lets available seats exceed the total (ADR-0002 inventory)', () => {
    expect(
      errorPaths(flight({ cabins: [{ ...economy, seatsAvailable: 151 }] })),
    ).toEqual(['cabins.0.seatsAvailable']);
  });

  it('declares the FLT-03 uniqueness and FLT-11 search indexes', () => {
    const indexes = FlightSchema.indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        [
          { airlineId: 1, flightNumber: 1, departureLocalDate: 1 },
          expect.objectContaining({ unique: true }),
        ],
        [{ from: 1, to: 1, status: 1, departureUtc: 1 }, expect.anything()],
        [{ status: 1, departureUtc: 1 }, expect.anything()],
      ]),
    );
  });
});

describe('airlines schema (TRVL-138)', () => {
  it('accepts a minimal airline with an active flag and an empty cancellation policy', () => {
    const doc = new AirlineModel({ name: 'EgyptAir', code: 'ms' });
    expect(errorPaths(doc)).toEqual([]);
    expect(doc.code).toBe('MS');
    expect(doc.isActive).toBe(true);
    expect(doc.logoUrl).toBeNull();
    expect(doc.policy.cancellationTiers).toEqual([]);
    expect(doc.policy.extraBaggage).toBeUndefined();
  });

  it('rejects a malformed code and a missing name', () => {
    expect(errorPaths(new AirlineModel({ code: 'EGYPT' })).sort()).toEqual([
      'code',
      'name',
    ]);
  });

  it('validates the policy tiers and extra-baggage values (FLT-08, FLT-09)', () => {
    const doc = new AirlineModel({
      name: 'EgyptAir',
      code: 'MS',
      policy: {
        cancellationTiers: [{ daysBefore: 1.5, refundPercent: 120 }],
        extraBaggage: { pricePerBagMinor: 0, maxExtraBagsPerPassenger: -1 },
      },
    });
    expect(errorPaths(doc).sort()).toEqual([
      'policy.cancellationTiers.0.daysBefore',
      'policy.cancellationTiers.0.refundPercent',
      'policy.extraBaggage.maxExtraBagsPerPassenger',
      'policy.extraBaggage.pricePerBagMinor',
    ]);
  });
});

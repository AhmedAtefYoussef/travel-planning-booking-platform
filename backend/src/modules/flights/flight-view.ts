import { durationMinutes, utcToLocalIso } from '../../common/utils/dates';
import type { FlightDto } from './dto/flight.dto';
import type { FlightDocument } from './schemas/flight.schema';

/** IATA code -> IANA zone, from REFERENCE_SERVICE (seeded Airports.csv). */
export type AirportZones = ReadonlyMap<string, string>;

/**
 * GEN-06: every flight response shows each time in the UTC instant AND in that airport's own local
 * time, using the airport's IANA zone (Luxon via common/utils/dates). Search (FLT-11) and details
 * (FLT-17) use the same mapper, so all flight responses agree.
 */
export function toFlightDto(
  flight: FlightDocument,
  zones: AirportZones,
): FlightDto {
  const zoneOf = (iata: string) => {
    const zone = zones.get(iata);
    // A flight can only be created with seeded airports, so a missing zone is a programming error.
    if (!zone) throw new Error(`No time zone loaded for airport ${iata}`);
    return zone;
  };
  const fromZone = zoneOf(flight.from);
  const toZone = zoneOf(flight.to);
  return {
    id: flight.id as string,
    airlineId: flight.airlineId.toHexString(),
    flightNumber: flight.flightNumber,
    status: flight.status,
    departure: {
      airport: flight.from,
      timeZone: fromZone,
      utc: flight.departureUtc,
      local: utcToLocalIso(flight.departureUtc, fromZone),
    },
    arrival: {
      airport: flight.to,
      timeZone: toZone,
      utc: flight.arrivalUtc,
      local: utcToLocalIso(flight.arrivalUtc, toZone),
    },
    departureLocalDate: flight.departureLocalDate,
    durationMinutes: durationMinutes(flight.departureUtc, flight.arrivalUtc),
    cabins: flight.cabins.map((c) => ({
      id: c._id.toHexString(),
      class: c.class,
      totalSeats: c.totalSeats,
      seatsAvailable: c.seatsAvailable,
      priceMinor: c.priceMinor,
      freeBags: c.freeBags,
      maxKgPerBag: c.maxKgPerBag,
    })),
    createdAt: flight.createdAt,
    updatedAt: flight.updatedAt,
  };
}

export { FlightsModule } from './flights.module';
export { Airline, AirlineSchema } from './schemas/airline.schema';
export type { AirlineDocument } from './schemas/airline.schema';
export {
  Cabin,
  CABIN_CLASSES,
  Flight,
  FlightSchema,
  FlightStatus,
} from './schemas/flight.schema';
export type { FlightDocument } from './schemas/flight.schema';
export { INFANT_FARE_PERCENT, partyErrors, priceParty } from './flight-pricing';
export type { Party, PartyPrice } from './flight-pricing';

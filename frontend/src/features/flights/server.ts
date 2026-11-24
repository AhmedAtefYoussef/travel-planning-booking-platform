/** Server-only entry of the flights feature (data loading and server-rendered views). */
export { listAllAirports, type Airport } from './api/airports.server';
export {
  searchFlights,
  type FlightResult,
  type SearchOutcome,
} from './api/search.server';
export { getFlight, type FlightDetails } from './api/flight.server';
export { SearchResults } from './ui/search-results';
export { FlightDetails as FlightDetailsView } from './ui/flight-details';

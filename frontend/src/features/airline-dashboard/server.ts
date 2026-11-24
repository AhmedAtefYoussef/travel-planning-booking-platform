/** Server-only entry of the airline dashboard: loaders and server-rendered views. */
export {
  assignedAirlineId,
  getAirline,
  getFlightBookings,
  getOwnFlight,
  listOwnFlights,
  type Airline,
  type FlightDetails,
} from './api/dashboard.server';
export { FlightsTable, flightStatusVariant } from './ui/flights-table';
export { FlightBookings } from './ui/flight-bookings';

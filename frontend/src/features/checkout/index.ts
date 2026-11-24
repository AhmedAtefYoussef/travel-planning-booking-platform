/** Checkout (FE-02): the shared pay flow for flight bookings and hotel reservations. */
export {
  isCheckoutKind,
  payPath,
  KINDS,
  type CheckoutKind,
} from './model/kinds';
export { parseFlightSelection, type FlightSelection } from './model/passengers';
export { CheckoutFlow } from './ui/checkout-flow';
export { parseHotelSelection, type HotelSelection } from './model/rooms';
export { FlightDetailsForm } from './ui/flight-details-form';
export { HotelDetailsForm } from './ui/hotel-details-form';
export { BookingSummary } from './ui/booking-summary';

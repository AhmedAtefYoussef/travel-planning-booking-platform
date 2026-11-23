/** Checkout (FE-02): the shared pay flow for flight bookings and hotel reservations. */
export {
  isCheckoutKind,
  payPath,
  KINDS,
  type CheckoutKind,
} from './model/kinds';
export { CheckoutFlow } from './ui/checkout-flow';
export { BookingSummary } from './ui/booking-summary';

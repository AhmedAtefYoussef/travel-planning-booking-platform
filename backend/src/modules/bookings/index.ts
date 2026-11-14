export { BookingLifecycleService } from './booking-lifecycle.service';
export { BookingsModule } from './bookings.module';
export {
  FLIGHT_BOOKINGS_COLLECTION,
  FlightBooking,
  FlightBookingSchema,
  FlightSegment,
  Passenger,
  PassengerType,
  TripType,
} from './schemas/flight-booking.schema';
export type { FlightBookingDocument } from './schemas/flight-booking.schema';
export {
  HOTEL_RESERVATIONS_COLLECTION,
  HotelReservation,
  HotelReservationSchema,
  ReservedRoom,
} from './schemas/hotel-reservation.schema';
export type { HotelReservationDocument } from './schemas/hotel-reservation.schema';

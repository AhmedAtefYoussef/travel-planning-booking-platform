import { Global, Module } from '@nestjs/common';
import {
  HOTEL_RESERVATIONS,
  NOTIFICATIONS_SERVICE,
  PAYABLE_BOOKING,
  POLICIES_PROVIDER,
} from '../contracts/tokens';
import { HotelReservationsStub } from './hotel-reservations.stub';
import { NotificationsStub } from './notifications.stub';
import { PayableBookingStub } from './payable-booking.stub';
import { PoliciesStub } from './policies.stub';

/**
 * Binds contract tokens to stubs until the owning modules ship. When a real
 * provider lands, remove its line here and bind the token in that module:
 *   { provide: PAYABLE_BOOKING, useExisting: FlightBookingsService }
 */
@Global()
@Module({
  providers: [
    PayableBookingStub,
    PoliciesStub,
    NotificationsStub,
    HotelReservationsStub,
    { provide: PAYABLE_BOOKING, useExisting: PayableBookingStub },
    { provide: POLICIES_PROVIDER, useExisting: PoliciesStub },
    { provide: NOTIFICATIONS_SERVICE, useExisting: NotificationsStub },
    { provide: HOTEL_RESERVATIONS, useExisting: HotelReservationsStub },
  ],
  exports: [
    PAYABLE_BOOKING,
    POLICIES_PROVIDER,
    NOTIFICATIONS_SERVICE,
    HOTEL_RESERVATIONS,
  ],
})
export class ContractStubsModule {}

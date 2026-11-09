import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  BookingType,
  type PayableBooking,
  type PayableBookingView,
} from '../../common/contracts/booking.contract';
import type {
  PoliciesProvider,
  PolicySnapshot,
  ProviderPolicies,
} from '../../common/contracts/policies.contract';
import {
  PAYABLE_BOOKING,
  POLICIES_PROVIDER,
} from '../../common/contracts/tokens';

/** PAY-02: policy display and the acceptance gate before payment. */
@Injectable()
export class BookingPoliciesService {
  constructor(
    @Inject(PAYABLE_BOOKING) private readonly bookings: PayableBooking,
    @Inject(POLICIES_PROVIDER) private readonly policies: PoliciesProvider,
  ) {}

  async getPolicies(
    userId: string,
    type: BookingType,
    id: string,
  ): Promise<ProviderPolicies> {
    const view = await this.owned(userId, type, id);
    return this.policies.getPolicies(view.providerId);
  }

  async accept(
    userId: string,
    type: BookingType,
    id: string,
  ): Promise<{ policiesAcceptedAt: Date }> {
    const view = await this.owned(userId, type, id);
    if (
      view.status !== BookingStatus.PENDING_PAYMENT ||
      !view.holdExpiresAt ||
      view.holdExpiresAt.getTime() <= Date.now()
    ) {
      throw new ConflictException('Booking is not open for acceptance');
    }
    const acceptedAt = new Date();
    const policies = await this.policies.getPolicies(view.providerId);
    const snapshot: PolicySnapshot = {
      ...policies,
      acceptedAt,
      timeZone: view.timeZone,
    };
    await this.bookings.recordPolicyAcceptance(type, id, snapshot);
    return { policiesAcceptedAt: acceptedAt };
  }

  private async owned(
    userId: string,
    type: BookingType,
    id: string,
  ): Promise<PayableBookingView> {
    const view = await this.bookings.getPayable(type, id);
    if (view.userId !== userId)
      throw new NotFoundException('Booking not found');
    return view;
  }
}

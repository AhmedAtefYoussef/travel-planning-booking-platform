import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Stripe from 'stripe';
import {
  BookingStatus,
  BookingType,
  type PayableBooking,
  type PayableBookingView,
} from '../../common/contracts/booking.contract';
import {
  CreatePaymentResult,
  PaymentStatus,
  PaymentsService as PaymentsServiceContract,
} from '../../common/contracts/payments.contract';
import { PAYABLE_BOOKING } from '../../common/contracts/tokens';
import { isValidMinor } from '../../common/utils/money';
import { Payment, PaymentDocument } from './schemas';
import { RefundsService } from './refunds.service';
import { STRIPE_CLIENT } from './stripe.provider';

export interface PaymentView {
  id: string;
  bookingType: BookingType;
  bookingId: string;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
}

@Injectable()
export class PaymentsService implements PaymentsServiceContract {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name) private readonly model: Model<PaymentDocument>,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    @Inject(PAYABLE_BOOKING) private readonly bookings: PayableBooking,
    private readonly refunds: RefundsService,
    private readonly config: ConfigService,
  ) {}

  /** PAY-04: the single platform currency, from PLATFORM_CURRENCY. */
  private get currency(): string {
    return this.config.getOrThrow<string>('PLATFORM_CURRENCY');
  }

  async createForBooking(
    userId: string,
    type: BookingType,
    bookingId: string,
  ): Promise<CreatePaymentResult> {
    const view = await this.ownedBooking(userId, type, bookingId);
    this.assertPayable(view);
    if (!view.policiesAcceptedAt) {
      throw new ConflictException('Policies must be accepted before payment');
    }

    const existing = await this.model.findOne({
      bookingType: type,
      bookingId,
      status: PaymentStatus.PENDING,
    });
    if (existing) {
      const pi = await this.stripe.paymentIntents.retrieve(existing.stripeId);
      return this.result(existing, pi.client_secret);
    }

    const pi = await this.newIntent(type, bookingId, view.totalMinor, 0);
    const doc = await this.model.create({
      bookingType: type,
      bookingId,
      userId,
      stripeId: pi.id,
      amountMinor: view.totalMinor,
      currency: this.currency,
      status: PaymentStatus.PENDING,
    });
    return this.result(doc, pi.client_secret);
  }

  async retry(userId: string, paymentId: string): Promise<CreatePaymentResult> {
    const payment = await this.ownedPayment(userId, paymentId);
    if (payment.status !== PaymentStatus.FAILED) {
      throw new ConflictException('Only a failed payment can be retried');
    }
    const view = await this.bookings.getPayable(
      payment.bookingType,
      payment.bookingId,
    );
    this.assertPayable(view);
    // A FAILED status can be stale (out-of-order events, re-confirmed PI):
    // never open a second intent while the old one has or may take money.
    const old = await this.stripe.paymentIntents.retrieve(payment.stripeId);
    if (old.status === 'succeeded' || old.status === 'processing') {
      throw new ConflictException(
        'The previous payment attempt is still being processed or succeeded',
      );
    }
    await this.cancelIntent(payment.stripeId);
    const pi = await this.newIntent(
      payment.bookingType,
      payment.bookingId,
      view.totalMinor,
      Date.now(),
    );
    const updated = await this.model.findOneAndUpdate(
      { _id: paymentId, status: PaymentStatus.FAILED },
      {
        stripeId: pi.id,
        status: PaymentStatus.PENDING,
        amountMinor: view.totalMinor,
        $addToSet: { stripeIdHistory: payment.stripeId },
      },
      { new: true },
    );
    if (!updated) throw new ConflictException('Payment already retried');
    return this.result(updated, pi.client_secret);
  }

  async getForUser(
    userId: string,
    isAdmin: boolean,
    paymentId: string,
  ): Promise<PaymentView> {
    const p = await this.model.findById(paymentId);
    if (!p) throw new NotFoundException('Payment not found');
    if (p.userId !== userId && !isAdmin) {
      throw new ForbiddenException('Not your payment');
    }
    return {
      id: String(p.id),
      bookingType: p.bookingType,
      bookingId: p.bookingId,
      amountMinor: p.amountMinor,
      currency: p.currency,
      status: p.status,
    };
  }

  /** Dev-only helper: confirms the PI; the webhook still confirms booking. */
  async testConfirm(userId: string, paymentId: string): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new NotFoundException();
    }
    const p = await this.ownedPayment(userId, paymentId);
    await this.stripe.paymentIntents.confirm(p.stripeId, {
      payment_method: 'pm_card_visa',
      return_url: 'http://localhost/payment-return',
    });
  }

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    if (!rawBody || !signature) {
      throw new BadRequestException('Missing webhook signature or body');
    }
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '',
      );
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
        return this.onSucceeded(event.data.object);
      case 'payment_intent.payment_failed':
        return this.onFailed(event.data.object);
      case 'refund.updated':
      case 'charge.refund.updated':
        return this.refunds.applyStripeRefund(event.data.object);
      default:
        return;
    }
  }

  async cancelForExpiredHold(
    type: BookingType,
    bookingId: string,
  ): Promise<void> {
    const open = await this.model.findOne({
      bookingType: type,
      bookingId,
      status: { $in: [PaymentStatus.PENDING, PaymentStatus.FAILED] },
    });
    if (!open) return;
    await this.stripe.paymentIntents.cancel(open.stripeId);
    await this.model.findOneAndUpdate(
      { _id: open.id },
      { status: PaymentStatus.CANCELLED },
      { new: true },
    );
  }

  private async onSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
    const payment = await this.model.findOne({
      $or: [{ stripeId: intent.id }, { stripeIdHistory: intent.id }],
    });
    if (!payment) {
      this.logger.error(
        `payment_intent.succeeded for unknown PaymentIntent ${intent.id}`,
      );
      return;
    }
    // Never trust the event body alone: re-read the intent from Stripe.
    const fresh = await this.stripe.paymentIntents.retrieve(intent.id);
    if (fresh.status !== 'succeeded') return;

    if (payment.stripeId !== intent.id) {
      // Superseded by a retry: money was taken twice. Never confirm.
      // refundPayment is idempotent per PI, so redelivery is safe.
      this.logger.warn(
        `Superseded PaymentIntent ${intent.id} succeeded for payment ${String(payment.id)}; refunding`,
      );
      await this.refunds.refundPayment(payment, fresh, 'PROVIDER');
      return;
    }

    // Money was captured on the current PI: whatever the local status
    // (PENDING, a stale FAILED, CANCELLED), record it as SUCCEEDED.
    // Atomic: only the first delivery performs the transition.
    const won = await this.model.findOneAndUpdate(
      {
        _id: payment.id,
        stripeId: intent.id,
        status: { $ne: PaymentStatus.SUCCEEDED },
      },
      { status: PaymentStatus.SUCCEEDED },
      { new: true },
    );

    const view = await this.bookings.getPayable(
      payment.bookingType,
      payment.bookingId,
    );
    const paymentId = String(payment.id);
    // Already settled by an earlier delivery (or later cancelled and
    // refunded through RefundsService.refundFor): nothing to do.
    if (view.paymentId === paymentId) return;

    if (this.isPayable(view)) {
      // markConfirmed is idempotent per paymentId; a redelivery after a
      // crash between the transition and this call completes the work.
      if (!won) {
        this.logger.warn(
          `Completing confirmation of booking ${payment.bookingId} for payment ${paymentId} on redelivery`,
        );
      }
      await this.bookings.markConfirmed(
        payment.bookingType,
        payment.bookingId,
        paymentId,
      );
      return;
    }

    // Booking is no longer payable (expired, cancelled, or confirmed by
    // another payment): give the captured money back. Runs on every
    // delivery until it succeeds; refundPayment dedupes per PI.
    this.logger.warn(
      `Late payment ${paymentId} for non-payable booking ${payment.bookingId}; refunding`,
    );
    await this.refunds.refundPayment(won ?? payment, fresh, 'PROVIDER');
  }

  private async onFailed(intent: Stripe.PaymentIntent): Promise<void> {
    const payment = await this.model.findOne({ stripeId: intent.id });
    if (!payment) return;
    const changed = await this.model.findOneAndUpdate(
      { _id: payment.id, status: PaymentStatus.PENDING },
      { status: PaymentStatus.FAILED },
      { new: true },
    );
    if (!changed) return;
    await this.bookings.markPaymentFailed(
      payment.bookingType,
      payment.bookingId,
    );
  }

  /** Cancels a PI, tolerating "already canceled/succeeded" states. */
  private async cancelIntent(stripeId: string): Promise<void> {
    try {
      await this.stripe.paymentIntents.cancel(stripeId);
    } catch (err) {
      if (
        (err as { code?: string }).code !== 'payment_intent_unexpected_state'
      ) {
        throw err;
      }
    }
  }

  private newIntent(
    type: BookingType,
    bookingId: string,
    amountMinor: number,
    attempt: number,
  ) {
    return this.stripe.paymentIntents.create(
      {
        amount: amountMinor,
        currency: this.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        metadata: { bookingType: type, bookingId },
      },
      { idempotencyKey: `pi-${type}-${bookingId}-${attempt}` },
    );
  }

  private result(
    p: { id?: string; amountMinor: number; currency: string },
    clientSecret: string | null,
  ): CreatePaymentResult {
    return {
      paymentId: String(p.id),
      clientSecret: clientSecret ?? '',
      amountMinor: p.amountMinor,
      currency: p.currency,
    };
  }

  private async ownedBooking(
    userId: string,
    type: BookingType,
    id: string,
  ): Promise<PayableBookingView> {
    const view = await this.bookings.getPayable(type, id);
    if (view.userId !== userId)
      throw new NotFoundException('Booking not found');
    return view;
  }

  private async ownedPayment(userId: string, id: string) {
    const p = await this.model.findById(id);
    if (!p || p.userId !== userId) {
      throw new NotFoundException('Payment not found');
    }
    return p;
  }

  private isPayable(view: PayableBookingView): boolean {
    return (
      view.status === BookingStatus.PENDING_PAYMENT &&
      !!view.holdExpiresAt &&
      view.holdExpiresAt.getTime() > Date.now()
    );
  }

  private assertPayable(view: PayableBookingView): void {
    if (view.status !== BookingStatus.PENDING_PAYMENT) {
      throw new ConflictException('Booking is not awaiting payment');
    }
    if (!view.holdExpiresAt || view.holdExpiresAt.getTime() <= Date.now()) {
      throw new ConflictException('Booking hold has expired');
    }
    // PAY-04: money is integer minor units; never open an intent for a
    // negative, fractional or zero total.
    if (!isValidMinor(view.totalMinor) || view.totalMinor <= 0) {
      throw new ConflictException('Booking total is not a valid amount');
    }
  }
}

import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { assertOwner } from '../../common/auth/access';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import {
  BookingStatus,
  BookingType,
  NOTIFICATIONS_SERVICE,
  NotificationType,
  type NotificationsService,
  type PayableSnapshot,
  type PaymentHoldRelease,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { formatMinor } from '../../common/utils/money';
import type { EnvironmentVariables } from '../../config/env.validation';
import { PayableBookings } from './booking-policies.service';
import { StripeRefundsService } from './refunds.service';
import type { CheckoutDto, PaymentDto } from './dto/payment.dto';
import {
  Payment,
  PaymentStatus,
  type PaymentDocument,
} from './schemas/payment.schema';
import { StripeEvent } from './schemas/stripe-event.schema';
import {
  PaymentProviderError,
  STRIPE_GATEWAY,
  type GatewayEvent,
  type StripeGateway,
} from './stripe.gateway';

/** A Stripe failure during a user request becomes a clear 503 instead of a masked 500. */
async function viaProvider<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof PaymentProviderError)) throw e;
    throw new AppException(
      HttpStatus.SERVICE_UNAVAILABLE,
      ErrorCode.SERVICE_UNAVAILABLE,
      'The payment provider could not be reached. Please try again in a moment.',
    );
  }
}

/** What happened when a successful payment was applied to its booking. */
export type SuccessOutcome =
  | { kind: 'confirmed'; payment: PaymentDocument }
  | { kind: 'late'; payment: PaymentDocument; reason: string }
  | { kind: 'unknown' };

const isDuplicateKey = (e: unknown, field: string) =>
  (e as { code?: number }).code === 11000 &&
  Object.keys(
    (e as { keyPattern?: Record<string, unknown> }).keyPattern ?? {},
  ).includes(field);

const conflict = (
  code: (typeof ErrorCode)[keyof typeof ErrorCode],
  message: string,
) => new AppException(HttpStatus.CONFLICT, code, message);

/**
 * PAY-01 payments with Stripe PaymentIntents in test mode (ADR-0003), and PAYMENT_HOLD_RELEASE for
 * the hold-expiry jobs.
 *
 * - Starting a payment checks the booking (owner, awaiting payment, hold running, policies accepted
 *   per PAY-02) and creates ONE PaymentIntent per booking for the server-side total in the platform
 *   currency (PAY-04). Only the client secret goes back; the card is entered in Stripe Elements.
 * - Only the signed webhook confirms a booking. The event id, the payment status and the booking
 *   confirmation are written in ONE transaction, so a replayed event is acknowledged and ignored and
 *   a failure rolls everything back for Stripe to retry (ADR-0003).
 * - A failed attempt leaves the booking payable; the user retries with the same intent until the
 *   hold ends, when the expiry job cancels the intent through cancelForBooking.
 * Stored per payment: Stripe intent id, amount, currency, status, attempts and Stripe's last error.
 */
@Injectable()
export class PaymentsService implements PaymentHoldRelease {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectModel(StripeEvent.name)
    private readonly events: Model<StripeEvent>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
    private readonly payables: PayableBookings,
    private readonly refunds: StripeRefundsService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    @Optional()
    @Inject(NOTIFICATIONS_SERVICE)
    private readonly notifications?: NotificationsService,
  ) {}

  /** POST /api/payments: starts (or resumes) the payment of the caller's booking. */
  async start(
    user: AuthUser,
    bookingType: BookingType,
    bookingId: string,
    now: Date = new Date(),
  ): Promise<CheckoutDto> {
    const booking = await this.payables
      .of(bookingType)
      .getPayable(bookingId, user.id);
    this.assertPayable(booking, now);

    // Query with the values of the booking the server loaded, never the raw request (CodeQL), and
    // as plain equality so no operator object can reach MongoDB.
    const type: BookingType =
      booking.bookingType === BookingType.Hotel
        ? BookingType.Hotel
        : BookingType.Flight;
    const existing = await this.payments
      .findOne({
        bookingType: { $eq: type },
        bookingId: { $eq: new Types.ObjectId(booking.bookingId) },
      })
      .sort({ createdAt: -1 })
      .exec();
    if (existing) return this.resume(existing, booking);

    const intent = await viaProvider(() =>
      this.stripe.createPaymentIntent({
        amountMinor: booking.amountMinor,
        currency: booking.currency,
        metadata: { bookingType, bookingId, userId: user.id },
        // One intent per booking even if the user double-clicks or two tabs race.
        idempotencyKey: `booking-${bookingType}-${bookingId}`,
      }),
    );
    let payment: PaymentDocument;
    try {
      payment = await this.payments.create({
        bookingType,
        bookingId: new Types.ObjectId(bookingId),
        userId: new Types.ObjectId(user.id),
        stripePaymentIntentId: intent.id,
        amountMinor: booking.amountMinor,
        currency: booking.currency,
        status: PaymentStatus.RequiresPayment,
      });
    } catch (e) {
      // A parallel request stored the same intent a moment earlier: use that record.
      if (!isDuplicateKey(e, 'stripePaymentIntentId')) throw e;
      payment = (await this.payments
        .findOne({ stripePaymentIntentId: intent.id })
        .exec()) as PaymentDocument;
    }
    return toCheckout(payment, this.secretOf(intent.clientSecret), booking);
  }

  /** POST /api/payments/:id/retry: another attempt with the same intent, until the hold ends. */
  async retry(
    user: AuthUser,
    paymentId: string,
    now: Date = new Date(),
  ): Promise<CheckoutDto> {
    const payment = await this.load(paymentId);
    assertOwner(user, payment.userId);
    const booking = await this.payables
      .of(payment.bookingType)
      .getPayable(payment.bookingId.toHexString(), user.id);
    this.assertPayable(booking, now);
    return this.resume(payment, booking, true);
  }

  /** GET /api/payments/:id: the owner, or an admin (ACC-17). */
  async findForUser(user: AuthUser, paymentId: string): Promise<PaymentDto> {
    const payment = await this.load(paymentId);
    assertOwner(user, payment.userId, { bypassRoles: [Role.Admin] });
    return toPaymentDto(payment);
  }

  /**
   * POST /api/payments/webhook. Verifies the signature against the exact raw body, then applies the
   * event. Returns whether the event was a replay.
   */
  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<{ received: true; duplicate: boolean }> {
    if (!rawBody?.length || !signature) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'Missing Stripe signature or body',
      );
    }
    let event: GatewayEvent;
    try {
      event = this.stripe.constructEvent(rawBody, signature);
    } catch {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'Invalid Stripe signature',
      );
    }
    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.afterSuccess(await this.applySuccess(event));
          break;
        case 'payment_intent.payment_failed':
          await this.applyFailure(event);
          break;
        case 'payment_intent.canceled':
          await this.applyCanceled(event);
          break;
        case 'refund.created':
        case 'refund.updated':
        case 'refund.failed':
        case 'charge.refund.updated':
          await this.applyRefundEvent(event);
          break;
        default:
          await this.recordEvent(event);
      }
    } catch (e) {
      if (isDuplicateKey(e, 'stripeEventId')) {
        return { received: true, duplicate: true };
      }
      throw e;
    }
    return { received: true, duplicate: false };
  }

  /**
   * ADR-0003 step 1: one transaction records the event id, marks the payment SUCCEEDED and confirms
   * the booking (PayableBooking.markConfirmed assigns the reference, FLT-23/HTL-17). A booking that
   * can no longer be confirmed (hold expired, flight cancelled) keeps the payment as SUCCEEDED and is
   * reported as 'late' so the money goes back (PAY-03).
   */
  async applySuccess(event: GatewayEvent): Promise<SuccessOutcome> {
    return this.connection.transaction(async (session) => {
      await this.events.create(
        [{ stripeEventId: event.id, type: event.type }],
        { session },
      );
      const payment = await this.payments
        .findOneAndUpdate(
          { stripePaymentIntentId: event.object.id },
          { $set: { status: PaymentStatus.Succeeded, lastError: null } },
          { new: true, session },
        )
        .exec();
      if (!payment) return { kind: 'unknown' };
      // Defence in depth: the amount is fixed server-side at creation, but only confirm when Stripe
      // collected exactly that amount in the platform currency.
      const { amountReceived, currency } = event.object;
      if (
        (amountReceived !== null &&
          amountReceived !== undefined &&
          amountReceived !== payment.amountMinor) ||
        (currency && currency !== payment.currency)
      ) {
        const reason = `Stripe collected ${amountReceived ?? '?'} ${currency ?? '?'} instead of ${payment.amountMinor} ${payment.currency}; the booking is not confirmed and the payment is refunded in full`;
        payment.lastError = reason.slice(0, 500);
        await payment.save({ session });
        return { kind: 'late', payment, reason };
      }
      try {
        await this.payables
          .of(payment.bookingType)
          .markConfirmed(
            payment.bookingId.toHexString(),
            { paymentId: payment.id as string },
            session,
          );
        return { kind: 'confirmed', payment };
      } catch (e) {
        if (!(e instanceof AppException) || e.getStatus() !== 409) throw e;
        const reason = `Paid after the booking could no longer be confirmed (${e.message}); the payment is being refunded in full`;
        payment.lastError = reason.slice(0, 500);
        await payment.save({ session });
        return { kind: 'late', payment, reason };
      }
    });
  }

  /**
   * PAYMENT_HOLD_RELEASE for an expired booking (PAY-01): cancels every open intent, and refunds in
   * full any payment that succeeded although the booking could not be confirmed. Throws when Stripe
   * fails, so the expiry job retries until everything is released.
   */
  async cancelForBooking(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<void> {
    const related = await this.payments
      .find({
        bookingType,
        bookingId: new Types.ObjectId(bookingId),
        status: {
          $in: [
            PaymentStatus.RequiresPayment,
            PaymentStatus.Failed,
            PaymentStatus.Succeeded,
          ],
        },
      })
      .exec();
    for (const payment of related) {
      if (payment.status === PaymentStatus.Succeeded) {
        // The booking expired, so a succeeded payment never confirmed it: give the money back.
        await this.refundLatePayment(payment);
        continue;
      }
      const intent = await this.stripe.cancelPaymentIntent(
        payment.stripePaymentIntentId,
      );
      if (intent.status === 'canceled') {
        await this.payments
          .updateOne(
            { _id: payment._id, status: { $ne: PaymentStatus.Succeeded } },
            { $set: { status: PaymentStatus.Canceled } },
          )
          .exec();
      }
      // A 'succeeded' intent is applied by its webhook ('late') and refunded on the next run.
    }
  }

  // ------------------------------------------------------------------------------------------------

  /** After the commit: tell the user (GEN-01, FLT-23, HTL-17) or log a late payment for refund. */
  private async afterSuccess(outcome: SuccessOutcome): Promise<void> {
    if (outcome.kind === 'unknown') return;
    const { payment } = outcome;
    if (outcome.kind === 'late') {
      this.logger.warn(
        `Payment ${payment.id as string} succeeded for a booking that could not be confirmed: ${outcome.reason}`,
      );
      // Refund at once; if Stripe is unreachable the hold-expiry sweep retries (cancelForBooking).
      await this.refundLatePayment(payment).catch((e: unknown) =>
        this.logger.warn(
          `Late-payment refund for ${payment.id as string} failed, retried later: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
      return;
    }
    if (!this.notifications) return;
    try {
      const booking = await this.payables
        .of(payment.bookingType)
        .getPayable(
          payment.bookingId.toHexString(),
          payment.userId.toHexString(),
        );
      const kind =
        payment.bookingType === BookingType.Flight
          ? 'flight booking'
          : 'hotel reservation';
      await this.notifications.notify({
        userId: payment.userId.toHexString(),
        type: NotificationType.BookingConfirmed,
        title: `Your ${kind} is confirmed`,
        body: `Booking reference ${booking.reference ?? ''}: payment of ${formatMinor(payment.amountMinor, payment.currency)} ${payment.currency} received.`,
        link: `/bookings/${payment.bookingType === BookingType.Flight ? 'flights' : 'hotels'}/${payment.bookingId.toHexString()}`,
      });
    } catch (e) {
      this.logger.warn(
        `Booking confirmed but the notification failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Event id, payment status and booking note commit together, like successes (ADR-0003). */
  private async applyFailure(event: GatewayEvent): Promise<void> {
    await this.connection.transaction(async (session) => {
      await this.events.create(
        [{ stripeEventId: event.id, type: event.type }],
        { session },
      );
      const reason = (
        event.object.lastPaymentErrorMessage ?? 'The payment failed'
      ).slice(0, 500);
      const payment = await this.payments
        .findOneAndUpdate(
          {
            stripePaymentIntentId: event.object.id,
            status: {
              $in: [PaymentStatus.RequiresPayment, PaymentStatus.Failed],
            },
          },
          { $set: { status: PaymentStatus.Failed, lastError: reason } },
          { new: true, session },
        )
        .exec();
      if (!payment) return;
      await this.payables
        .of(payment.bookingType)
        .markPaymentFailed(
          payment.bookingId.toHexString(),
          { paymentId: payment.id as string, reason },
          session,
        );
    });
  }

  private async applyCanceled(event: GatewayEvent): Promise<void> {
    await this.connection.transaction(async (session) => {
      await this.events.create(
        [{ stripeEventId: event.id, type: event.type }],
        { session },
      );
      await this.payments
        .updateOne(
          {
            stripePaymentIntentId: event.object.id,
            status: { $ne: PaymentStatus.Succeeded },
          },
          { $set: { status: PaymentStatus.Canceled } },
          { session },
        )
        .exec();
    });
  }

  /** PAY-03: a refund's final status, in one transaction with the event id; then notify the user. */
  private async applyRefundEvent(event: GatewayEvent): Promise<void> {
    const changed = await this.connection.transaction(async (session) => {
      await this.events.create(
        [{ stripeEventId: event.id, type: event.type }],
        { session },
      );
      return this.refunds.applyStripeStatus(event, session);
    });
    if (changed) await this.refunds.notifyStatus(changed);
  }

  /**
   * Full refund of a payment whose booking was never confirmed. The idempotency key makes a retry
   * return the same Stripe refund instead of refunding twice.
   */
  private async refundLatePayment(payment: PaymentDocument): Promise<void> {
    if (payment.lateRefundId) return;
    const refund = await this.stripe.createRefund({
      paymentIntentId: payment.stripePaymentIntentId,
      amountMinor: payment.amountMinor,
      metadata: {
        bookingType: payment.bookingType,
        bookingId: payment.bookingId.toHexString(),
        reason: 'payment_after_booking_could_not_be_confirmed',
      },
      idempotencyKey: `late-${payment.id as string}`,
    });
    await this.payments
      .updateOne(
        { _id: payment._id, lateRefundId: { $exists: false } },
        {
          $set: {
            lateRefundId: refund.id,
            lastError: (
              payment.lastError ??
              'Paid after the booking could no longer be confirmed'
            )
              .replace(
                'is being refunded in full',
                `was refunded in full (${refund.id})`,
              )
              .replace(
                'the payment is refunded in full',
                `the payment was refunded in full (${refund.id})`,
              )
              .slice(0, 500),
          },
        },
      )
      .exec();
  }

  /** Inserts the event id; a duplicate key means a replay (handled by the caller). */
  private async recordEvent(event: GatewayEvent): Promise<void> {
    await this.events.create({ stripeEventId: event.id, type: event.type });
  }

  /** Same intent, new attempt: Stripe lets a failed intent be confirmed again with a new card. */
  private async resume(
    payment: PaymentDocument,
    booking: PayableSnapshot,
    countAttempt = false,
  ): Promise<CheckoutDto> {
    if (payment.status === PaymentStatus.Succeeded) {
      throw conflict(
        ErrorCode.CONFLICT,
        'This booking is already paid; it is being confirmed',
      );
    }
    if (payment.status === PaymentStatus.Canceled) {
      throw conflict(
        ErrorCode.HOLD_EXPIRED,
        'This payment was cancelled because the hold expired',
      );
    }
    const intent = await viaProvider(() =>
      this.stripe.retrievePaymentIntent(payment.stripePaymentIntentId),
    );
    if (intent.status === 'succeeded') {
      throw conflict(
        ErrorCode.CONFLICT,
        'This booking is already paid; it is being confirmed',
      );
    }
    if (intent.status === 'canceled') {
      throw conflict(
        ErrorCode.HOLD_EXPIRED,
        'This payment was cancelled because the hold expired',
      );
    }
    if (countAttempt) {
      const updated = await this.payments
        .findOneAndUpdate(
          {
            _id: payment._id,
            status: {
              $in: [PaymentStatus.RequiresPayment, PaymentStatus.Failed],
            },
          },
          {
            $set: { status: PaymentStatus.RequiresPayment, lastError: null },
            $inc: { attempts: 1 },
          },
          { new: true },
        )
        .exec();
      if (updated) payment = updated;
    }
    return toCheckout(payment, this.secretOf(intent.clientSecret), booking);
  }

  /** PAY-01/PAY-02/PAY-04 preconditions for charging a booking. */
  private assertPayable(booking: PayableSnapshot, now: Date): void {
    if (booking.status !== BookingStatus.PendingPayment) {
      throw conflict(
        ErrorCode.INVALID_STATE_TRANSITION,
        `Only a booking awaiting payment can be paid; this one is ${booking.status}`,
      );
    }
    if (booking.holdExpiresAt.getTime() <= now.getTime()) {
      throw conflict(
        ErrorCode.HOLD_EXPIRED,
        'The 10-minute hold has expired; hold the booking again',
      );
    }
    if (!booking.policiesAcceptedAt) {
      throw conflict(
        ErrorCode.POLICIES_NOT_ACCEPTED,
        'Accept the provider policies first (POST /api/bookings/{type}/{id}/accept-policies, PAY-02)',
      );
    }
    const platform = this.config
      .get('PLATFORM_CURRENCY', { infer: true })
      .toUpperCase();
    if (booking.currency !== platform) {
      // PAY-04: every price and payment is in the single platform currency.
      throw new Error(
        `Booking ${booking.bookingId} is priced in ${booking.currency}, not ${platform}`,
      );
    }
  }

  private secretOf(clientSecret: string | null): string {
    if (!clientSecret)
      throw new Error(
        'Stripe returned a PaymentIntent without a client secret',
      );
    return clientSecret;
  }

  private async load(paymentId: string): Promise<PaymentDocument> {
    const payment = Types.ObjectId.isValid(paymentId)
      ? await this.payments.findById(paymentId).exec()
      : null;
    if (!payment) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Payment not found',
      );
    }
    return payment;
  }
}

export function toPaymentDto(payment: PaymentDocument): PaymentDto {
  return {
    id: payment.id as string,
    bookingType: payment.bookingType,
    bookingId: payment.bookingId.toHexString(),
    stripePaymentIntentId: payment.stripePaymentIntentId,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    status: payment.status,
    attempts: payment.attempts,
    lastError: payment.lastError ?? null,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

function toCheckout(
  payment: PaymentDocument,
  clientSecret: string,
  booking: PayableSnapshot,
): CheckoutDto {
  return {
    ...toPaymentDto(payment),
    clientSecret,
    holdExpiresAt: booking.holdExpiresAt,
  };
}

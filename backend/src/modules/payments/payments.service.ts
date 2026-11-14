import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AuthUser, Role } from '../../common/auth/auth.types';
import {
  assertPayable,
  BookingType,
  FLIGHT_PAYABLE_BOOKING,
  HOTEL_PAYABLE_BOOKING,
  RefundReason,
  RefundStatus,
  type PayableBooking,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { isReferenceCollision } from '../../common/utils/booking-reference';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { CreatePaymentDto, PaymentDto } from './dto/payment.dto';
import {
  Payment,
  PaymentStatus,
  type PaymentDocument,
} from './schemas/payment.schema';
import { Refund } from './schemas/refund.schema';
import { StripeEvent } from './schemas/stripe-event.schema';
import {
  STRIPE_GATEWAY,
  StripeApiError,
  type StripeGateway,
  type StripeWebhookEvent,
} from './stripe-gateway';
import { verifyStripeSignature } from './stripe-signature';

const DUPLICATE_KEY = 11000;
const CONFIRM_ATTEMPTS = 3;
const MAX_ERROR_LENGTH = 500;
/** The cancel-on-expiry job's batch size. */
export const CANCEL_BATCH = 100;

const OPEN = [PaymentStatus.RequiresPayment, PaymentStatus.Failed];

/** Thrown inside a webhook transaction when the event id is already recorded (a replay). */
class EventReplay extends Error {}

/**
 * PAY-01 (ADR-0003): pay a Pending Payment booking within its hold with a Stripe PaymentIntent (card
 * details go from Stripe Elements straight to Stripe), confirm ONLY from a signature-verified webhook,
 * let the user retry after a failure until the hold expires, and cancel the PaymentIntent when it does.
 * A payment that Stripe captures after the hold expired is refunded in full.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
    @InjectModel(StripeEvent.name) private readonly events: Model<StripeEvent>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
    @Inject(FLIGHT_PAYABLE_BOOKING) private readonly flights: PayableBooking,
    @Inject(HOTEL_PAYABLE_BOOKING) private readonly hotels: PayableBooking,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /* ------------------------------------- user endpoints ------------------------------------- */

  /**
   * Starts (or resumes) paying for a booking: the payment gate first (hold, status, PAY-02 acceptance,
   * PAY-04 currency), then one PaymentIntent per booking for its server-side total. Asking again, even
   * concurrently, returns the same payment: Stripe's idempotency key gives the same PaymentIntent and its
   * unique id keeps one payment document.
   */
  async create(
    user: AuthUser,
    dto: CreatePaymentDto,
    now: Date = new Date(),
  ): Promise<PaymentDto> {
    const booking = await this.payable(dto.bookingType).getPayable(
      dto.bookingId,
      user.id,
    );
    assertPayable(booking, { now, platformCurrency: this.platformCurrency() });
    const existing = await this.payments
      .findOne({
        bookingType: dto.bookingType,
        bookingId: new Types.ObjectId(dto.bookingId),
        status: { $in: OPEN },
      })
      .exec();
    if (existing) return this.view(existing, booking.reference, true);

    const intent = await this.gateway(() =>
      this.stripe.createPaymentIntent({
        amountMinor: booking.amountMinor,
        currency: booking.currency,
        metadata: {
          bookingType: dto.bookingType,
          bookingId: dto.bookingId,
          userId: user.id,
        },
        idempotencyKey: `checkout:${dto.bookingType}:${dto.bookingId}`,
      }),
    );
    try {
      const [created] = await this.payments.create([
        {
          bookingType: dto.bookingType,
          bookingId: new Types.ObjectId(dto.bookingId),
          userId: new Types.ObjectId(user.id),
          stripePaymentIntentId: intent.id,
          amountMinor: booking.amountMinor,
          currency: booking.currency,
          status: PaymentStatus.RequiresPayment,
          holdEndsAt: booking.holdExpiresAt,
        },
      ]);
      return toDto(created, booking.reference, intent.clientSecret);
    } catch (e) {
      // A concurrent request stored the same PaymentIntent first: return that payment.
      if ((e as { code?: number }).code !== DUPLICATE_KEY) throw e;
      const winner = await this.payments
        .findOne({ stripePaymentIntentId: intent.id })
        .exec();
      if (!winner) throw e;
      return toDto(winner, booking.reference, intent.clientSecret);
    }
  }

  /** After a failed attempt the same PaymentIntent is confirmed again, until the hold expires. */
  async retry(
    user: AuthUser,
    id: string,
    now: Date = new Date(),
  ): Promise<PaymentDto> {
    const payment = await this.load(user, id, false);
    const booking = await this.payable(payment.bookingType).getPayable(
      payment.bookingId.toHexString(),
      user.id,
    );
    assertPayable(booking, { now, platformCurrency: this.platformCurrency() });
    if (payment.status === PaymentStatus.RequiresPayment) {
      return this.view(payment, booking.reference, true);
    }
    if (payment.status !== PaymentStatus.Failed) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
        `This payment is ${payment.status} and cannot be retried`,
      );
    }
    const intent = await this.gateway(() =>
      this.stripe.retrievePaymentIntent(payment.stripePaymentIntentId),
    );
    if (intent.status === 'canceled' || intent.status === 'succeeded') {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
        `Stripe reports this payment as ${intent.status}; it cannot be retried`,
      );
    }
    const updated = await this.payments
      .findOneAndUpdate(
        { _id: payment._id, status: PaymentStatus.Failed },
        {
          $set: { status: PaymentStatus.RequiresPayment },
          $unset: { lastError: 1 },
          $inc: { attempts: 1 },
        },
        { new: true },
      )
      .exec();
    // Another retry (or a webhook) moved it first: show where it is now.
    const current = updated ?? (await this.load(user, id, false));
    return toDto(current, booking.reference, intent.clientSecret);
  }

  /** The owner sees their payment (with the client secret while it can still be paid); an admin sees any. */
  async findOne(user: AuthUser, id: string): Promise<PaymentDto> {
    const payment = await this.load(user, id, true);
    const owner = payment.userId.toHexString() === user.id;
    const booking = await this.payable(payment.bookingType)
      .getPayable(payment.bookingId.toHexString(), payment.userId.toHexString())
      .catch(() => null);
    return this.view(payment, booking?.reference ?? null, owner);
  }

  /* ------------------------------------- Stripe webhook ------------------------------------- */

  /**
   * ADR-0003. Verifies the signature against the raw body (400 otherwise), then applies the event in ONE
   * transaction with the insert of its id, so a replay is acknowledged and ignored, and any failure rolls
   * the id back (500) for Stripe to redeliver.
   */
  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    now: Date = new Date(),
  ): Promise<void> {
    const secret = this.config.get('STRIPE_WEBHOOK_SECRET', { infer: true });
    if (!rawBody || !verifyStripeSignature(rawBody, signature, secret, now)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'Invalid Stripe signature',
      );
    }
    const event = parseEvent(rawBody);
    const intentId = event.data.object.id ?? '';
    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          return await this.onSucceeded(event, intentId);
        case 'payment_intent.payment_failed':
          return await this.onFailed(event, intentId);
        case 'payment_intent.canceled':
          return await this.inTransaction(event, async (session) => {
            await this.payments
              .updateOne(
                { stripePaymentIntentId: intentId, status: { $in: OPEN } },
                { $set: { status: PaymentStatus.Canceled } },
                { session },
              )
              .exec();
          });
        default:
          return await this.inTransaction(event, () => Promise.resolve());
      }
    } catch (e) {
      if (e instanceof EventReplay) return;
      this.logger.error(
        `Stripe event ${event.id} (${event.type}) failed; Stripe will redeliver it`,
        e instanceof Error ? e.stack : String(e),
      );
      // Always a 5xx (never the 404/409 of a domain error), so Stripe keeps redelivering the event.
      throw e instanceof AppException
        ? new Error(
            `Stripe event ${event.id} could not be applied: ${e.message}`,
          )
        : e;
    }
  }

  private async onSucceeded(
    event: StripeWebhookEvent,
    intentId: string,
  ): Promise<void> {
    let late: PaymentDocument | null = null;
    for (let attempt = 1; ; attempt++) {
      try {
        await this.inTransaction(event, async (session) => {
          late = null;
          const payment = await this.payments
            .findOneAndUpdate(
              { stripePaymentIntentId: intentId },
              {
                $set: { status: PaymentStatus.Succeeded },
                $unset: { lastError: 1 },
              },
              { new: true, session },
            )
            .exec();
          if (!payment) {
            this.logger.warn(
              `Stripe event ${event.id}: PaymentIntent ${intentId} is not one of ours; ignored`,
            );
            return;
          }
          try {
            await this.payable(payment.bookingType).markConfirmed(
              payment.bookingId.toHexString(),
              { paymentId: payment.id as string },
              session,
            );
          } catch (e) {
            // Paid, but the booking can no longer be confirmed (the hold expired first): refund it.
            if (
              !(e instanceof AppException) ||
              (e.code !== ErrorCode.HOLD_EXPIRED &&
                e.code !== ErrorCode.INVALID_STATE_TRANSITION)
            ) {
              throw e;
            }
            await this.recordLateRefund(payment, session);
            late = payment;
          }
        });
        break;
      } catch (e) {
        // A booking reference collision aborts the transaction and withTransaction does not retry it.
        if (!isReferenceCollision(e) || attempt === CONFIRM_ATTEMPTS) throw e;
      }
    }
    if (late) await this.refundLate(late);
  }

  private async onFailed(
    event: StripeWebhookEvent,
    intentId: string,
  ): Promise<void> {
    const reason = (
      event.data.object.last_payment_error?.message ?? 'The payment failed'
    ).slice(0, MAX_ERROR_LENGTH);
    let failed: PaymentDocument | null = null;
    await this.inTransaction(event, async (session) => {
      failed = await this.payments
        .findOneAndUpdate(
          {
            stripePaymentIntentId: intentId,
            status: PaymentStatus.RequiresPayment,
          },
          { $set: { status: PaymentStatus.Failed, lastError: reason } },
          { new: true, session },
        )
        .exec();
    });
    const payment = failed as PaymentDocument | null;
    if (!payment) return;
    // The booking stays Pending Payment, so the user can retry until the hold expires.
    await this.payable(payment.bookingType)
      .markPaymentFailed(payment.bookingId.toHexString(), {
        paymentId: payment.id as string,
        reason,
      })
      .catch((e: unknown) =>
        this.logger.error(
          `Payment ${payment.id as string} failed but its booking could not be told`,
          e instanceof Error ? e.stack : String(e),
        ),
      );
  }

  /** Records the event id and applies `work` in one transaction; a recorded id means a replay. */
  private async inTransaction(
    event: StripeWebhookEvent,
    work: (session: ClientSession) => Promise<void>,
  ): Promise<void> {
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        try {
          await this.events.create(
            [{ stripeEventId: event.id, type: event.type }],
            { session },
          );
        } catch (e) {
          if ((e as { code?: number }).code === DUPLICATE_KEY) {
            throw new EventReplay(event.id);
          }
          throw e;
        }
        await work(session);
      });
    } finally {
      await session.endSession();
    }
  }

  /** The refund owed for a late payment, recorded in the webhook transaction (PENDING until Stripe has it). */
  private async recordLateRefund(
    payment: PaymentDocument,
    session: ClientSession,
  ): Promise<void> {
    await this.refunds
      .updateOne(
        { bookingType: payment.bookingType, bookingId: payment.bookingId },
        {
          $setOnInsert: {
            paymentId: payment._id,
            userId: payment.userId,
            amountMinor: payment.amountMinor,
            currency: payment.currency,
            refundPercent: 100,
            tierApplied: null,
            reason: RefundReason.HoldExpired,
            status: RefundStatus.Pending,
          },
        },
        { upsert: true, session },
      )
      .exec();
  }

  /** After commit: ask Stripe for the refund. A failure is logged and the refund stays PENDING. */
  private async refundLate(payment: PaymentDocument): Promise<void> {
    try {
      const refund = await this.stripe.createRefund({
        paymentIntentId: payment.stripePaymentIntentId,
        metadata: {
          paymentId: payment.id as string,
          reason: RefundReason.HoldExpired,
        },
        idempotencyKey: `late-refund:${payment.id as string}`,
      });
      await this.refunds
        .updateOne(
          { paymentId: payment._id },
          { $set: { stripeRefundId: refund.id } },
        )
        .exec();
      this.logger.warn(
        `Payment ${payment.id as string} succeeded after the hold of ${payment.bookingType} booking ${payment.bookingId.toHexString()} expired; refunded in full (${refund.id})`,
      );
    } catch (e) {
      this.logger.error(
        `Payment ${payment.id as string} must be refunded (hold expired) but Stripe refused; the refund stays PENDING`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  /* ------------------------------------- expiry job ------------------------------------- */

  /**
   * PAY-01: when the hold has expired, its PaymentIntent is cancelled so it can no longer be paid. One
   * failure is logged and does not stop the others. If Stripe already captured it, the succeeded webhook
   * refunds it (ADR-0003).
   */
  async cancelExpiredIntents(now: Date = new Date()): Promise<number> {
    const due = await this.payments
      .find({ status: { $in: OPEN }, holdEndsAt: { $lte: now } })
      .sort({ holdEndsAt: 1 })
      .limit(CANCEL_BATCH)
      .exec();
    let cancelled = 0;
    for (const payment of due) {
      try {
        let status: string;
        try {
          status = (
            await this.stripe.cancelPaymentIntent(payment.stripePaymentIntentId)
          ).status;
        } catch (e) {
          if (
            !(e instanceof StripeApiError) ||
            e.code !== 'payment_intent_unexpected_state'
          ) {
            throw e;
          }
          status = (
            await this.stripe.retrievePaymentIntent(
              payment.stripePaymentIntentId,
            )
          ).status;
        }
        if (status === 'canceled') {
          const res = await this.payments
            .updateOne(
              { _id: payment._id, status: { $in: OPEN } },
              { $set: { status: PaymentStatus.Canceled } },
            )
            .exec();
          cancelled += res.modifiedCount;
        } else {
          this.logger.warn(
            `Payment ${payment.id as string}: hold expired but Stripe reports ${status}; the webhook decides`,
          );
        }
      } catch (e) {
        this.logger.error(
          `Cancelling the PaymentIntent of payment ${payment.id as string} failed; retried next run`,
          e instanceof Error ? e.stack : String(e),
        );
      }
    }
    if (due.length === CANCEL_BATCH) {
      this.logger.warn(
        `PaymentIntent cancel backlog: a full batch of ${CANCEL_BATCH} was due`,
      );
    }
    return cancelled;
  }

  /* ------------------------------------- helpers ------------------------------------- */

  private payable(type: BookingType): PayableBooking {
    return type === BookingType.Flight ? this.flights : this.hotels;
  }

  private platformCurrency(): string {
    return this.config.get('PLATFORM_CURRENCY', { infer: true });
  }

  /** Owner (or, when `adminToo`, an admin); anyone else gets 404 (ACC-11, OWASP API1). */
  private async load(
    user: AuthUser,
    id: string,
    adminToo: boolean,
  ): Promise<PaymentDocument> {
    const payment = Types.ObjectId.isValid(id)
      ? await this.payments.findById(id).exec()
      : null;
    const allowed =
      payment &&
      (payment.userId.toHexString() === user.id ||
        (adminToo && user.role === Role.Admin));
    if (!payment || !allowed) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Payment not found',
      );
    }
    return payment;
  }

  /** The DTO, with the client secret for the owner while the payment can still be paid. */
  private async view(
    payment: PaymentDocument,
    reference: string | null,
    owner: boolean,
  ): Promise<PaymentDto> {
    if (!owner || !OPEN.includes(payment.status)) {
      return toDto(payment, reference);
    }
    const intent = await this.gateway(() =>
      this.stripe.retrievePaymentIntent(payment.stripePaymentIntentId),
    );
    return toDto(payment, reference, intent.clientSecret);
  }

  /** A Stripe outage is a 503 the user can retry, never a raw 500. */
  private async gateway<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (e) {
      if (!(e instanceof StripeApiError)) throw e;
      this.logger.error(
        `Stripe call failed (${e.httpStatus} ${e.code ?? ''}): ${e.message}`,
      );
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.SERVICE_UNAVAILABLE,
        'Payments are unavailable right now; try again in a moment',
      );
    }
  }
}

/** The fields the handler reads; anything else is a malformed event (400). */
function parseEvent(rawBody: Buffer): StripeWebhookEvent {
  let event: Partial<StripeWebhookEvent> | null = null;
  try {
    event = JSON.parse(rawBody.toString('utf8')) as Partial<StripeWebhookEvent>;
  } catch {
    event = null;
  }
  if (
    !event ||
    typeof event.id !== 'string' ||
    !event.id.startsWith('evt_') ||
    typeof event.type !== 'string' ||
    typeof event.data?.object !== 'object' ||
    event.data.object === null
  ) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.BAD_REQUEST,
      'Malformed Stripe event',
    );
  }
  return event as StripeWebhookEvent;
}

function toDto(
  p: PaymentDocument,
  reference: string | null,
  clientSecret?: string,
): PaymentDto {
  return {
    id: p.id as string,
    bookingType: p.bookingType,
    bookingId: p.bookingId.toHexString(),
    status: p.status,
    amountMinor: p.amountMinor,
    currency: p.currency,
    attempts: p.attempts,
    lastError: p.lastError ?? null,
    holdExpiresAt: p.holdEndsAt,
    reference,
    ...(clientSecret !== undefined && { clientSecret }),
    createdAt: p.createdAt,
  };
}

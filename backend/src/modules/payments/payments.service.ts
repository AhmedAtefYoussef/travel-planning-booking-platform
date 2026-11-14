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
import { Refund, type RefundDocument } from './schemas/refund.schema';
import { StripeEvent } from './schemas/stripe-event.schema';
import {
  STRIPE_GATEWAY,
  StripeApiError,
  type IntentStatus,
  type StripeGateway,
  type StripeWebhookEvent,
} from './stripe-gateway';
import { verifyStripeSignature } from './stripe-signature';

const DUPLICATE_KEY = 11000;
const CONFIRM_ATTEMPTS = 3;
const MAX_ERROR_LENGTH = 500;
/** The jobs' batch size. */
export const JOB_BATCH = 100;
/** Cancel-job backoff for a payment it could not settle: 1, 2, 4 ... minutes, at most an hour. */
const MAX_BACKOFF_MS = 60 * 60_000;

const OPEN = [PaymentStatus.RequiresPayment, PaymentStatus.Failed];

/** A paid booking that can no longer be confirmed is refunded in full (ADR-0003). */
const REFUNDABLE_CODES: readonly string[] = [
  ErrorCode.HOLD_EXPIRED,
  ErrorCode.INVALID_STATE_TRANSITION,
  ErrorCode.NOT_FOUND,
];

/** Thrown inside a webhook transaction when the event id is already recorded (a replay). */
class EventReplay extends Error {}

/**
 * PAY-01 (ADR-0003): pay a Pending Payment booking within its hold with a Stripe PaymentIntent (card
 * details go from Stripe Elements straight to Stripe), confirm ONLY from a signature-verified webhook,
 * let the user retry after a failure until the hold expires, and cancel the PaymentIntent when it does.
 * A payment that Stripe captures when the booking can no longer be confirmed is refunded in full, and a
 * job keeps re-sending such refunds until Stripe has them.
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
   * PAY-04 currency), then a PaymentIntent for its server-side total. An open payment is returned as it
   * is. Otherwise a new PaymentIntent is created under an idempotency key that includes the booking's
   * payment count, so concurrent clicks share one PaymentIntent, while a booking whose earlier
   * PaymentIntent was cancelled (hold still valid) gets a fresh one.
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
    const forBooking = {
      bookingType: dto.bookingType,
      bookingId: new Types.ObjectId(dto.bookingId),
    };
    const existing = await this.payments
      .findOne({ ...forBooking, status: { $in: OPEN } })
      .exec();
    if (existing) return this.view(existing, booking.reference, true, now);

    const generation = await this.payments.countDocuments(forBooking).exec();
    const intent = await this.gateway(() =>
      this.stripe.createPaymentIntent({
        amountMinor: booking.amountMinor,
        currency: booking.currency,
        metadata: {
          bookingType: dto.bookingType,
          bookingId: dto.bookingId,
          userId: user.id,
        },
        idempotencyKey: `checkout:${dto.bookingType}:${dto.bookingId}:${generation}`,
      }),
    );
    try {
      const [created] = await this.payments.create([
        {
          ...forBooking,
          userId: new Types.ObjectId(user.id),
          stripePaymentIntentId: intent.id,
          amountMinor: booking.amountMinor,
          currency: booking.currency,
          status: PaymentStatus.RequiresPayment,
          holdEndsAt: booking.holdExpiresAt,
          attemptStartedAt: now,
        },
      ]);
      return toDto(created, booking.reference, intent.clientSecret);
    } catch (e) {
      if ((e as { code?: number }).code === DUPLICATE_KEY) {
        // A concurrent request stored the same PaymentIntent first: return that payment if still open.
        const winner = await this.payments
          .findOne({ stripePaymentIntentId: intent.id })
          .exec();
        if (winner && OPEN.includes(winner.status)) {
          return toDto(winner, booking.reference, intent.clientSecret);
        }
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          'This payment changed while it was being created. Try again',
        );
      }
      // Never leave a payable PaymentIntent without its record: cancel it (best effort) and fail.
      await this.stripe
        .cancelPaymentIntent(intent.id)
        .catch((cancelError: unknown) =>
          this.logger.error(
            `PaymentIntent ${intent.id} has no payment record and could not be cancelled`,
            cancelError instanceof Error
              ? cancelError.stack
              : String(cancelError),
          ),
        );
      throw e;
    }
  }

  /**
   * After a failed attempt the same PaymentIntent is confirmed again, until the hold expires. If Stripe
   * cancelled it meanwhile (hold still valid), the payment is closed and a new one is started.
   */
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
      return this.view(payment, booking.reference, true, now);
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
    if (intent.status === 'succeeded') {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
        'Stripe already took this payment; the booking is being confirmed',
      );
    }
    if (intent.status === 'canceled') {
      await this.payments
        .updateOne(
          { _id: payment._id, status: PaymentStatus.Failed },
          { $set: { status: PaymentStatus.Canceled } },
        )
        .exec();
      return this.create(
        user,
        {
          bookingType: payment.bookingType,
          bookingId: payment.bookingId.toHexString(),
        },
        now,
      );
    }
    const updated = await this.payments
      .findOneAndUpdate(
        { _id: payment._id, status: PaymentStatus.Failed },
        {
          $set: {
            status: PaymentStatus.RequiresPayment,
            attemptStartedAt: now,
          },
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
  async findOne(
    user: AuthUser,
    id: string,
    now: Date = new Date(),
  ): Promise<PaymentDto> {
    const payment = await this.load(user, id, true);
    const owner = payment.userId.toHexString() === user.id;
    let reference: string | null = null;
    try {
      reference = (
        await this.payable(payment.bookingType).getPayable(
          payment.bookingId.toHexString(),
          payment.userId.toHexString(),
        )
      ).reference;
    } catch (e) {
      if (!(e instanceof AppException) || e.code !== ErrorCode.NOT_FOUND)
        throw e;
      this.logger.warn(
        `Payment ${id}: its ${payment.bookingType} booking ${payment.bookingId.toHexString()} no longer exists`,
      );
    }
    return this.view(payment, reference, owner, now);
  }

  /* ------------------------------------- Stripe webhook ------------------------------------- */

  /**
   * ADR-0003. Verifies the signature against the raw body (400 otherwise), then applies the event in ONE
   * transaction with the insert of its id, so a replay is acknowledged and ignored, and any failure rolls
   * the id back and answers 5xx for Stripe to redeliver.
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
    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          return await this.onSucceeded(event);
        case 'payment_intent.payment_failed':
          return await this.onFailed(event);
        case 'payment_intent.canceled':
          return await this.inTransaction(event, async (session) => {
            await this.payments
              .updateOne(
                {
                  stripePaymentIntentId: event.data.object.id,
                  status: { $in: OPEN },
                },
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

  /**
   * payment_intent.succeeded (also used by the cancel job when Stripe reports a capture before the
   * webhook arrived): the payment becomes SUCCEEDED and the booking is confirmed, or, when it can no
   * longer be, a full refund is recorded in the same transaction and requested after commit.
   */
  private async onSucceeded(event: StripeWebhookEvent): Promise<void> {
    const intentId = event.data.object.id!;
    let refundFor: Types.ObjectId | null = null;
    for (let attempt = 1; ; attempt++) {
      try {
        refundFor = await this.inTransaction(event, async (session) => {
          const payment = await this.payments
            .findOne({ stripePaymentIntentId: intentId })
            .session(session)
            .exec();
          if (!payment) {
            if (event.data.object.metadata?.bookingId) {
              // Ours (it names a booking) but unrecorded: never acknowledge money we can't account for.
              throw new Error(
                `PaymentIntent ${intentId} of booking ${event.data.object.metadata.bookingId} has no payment record`,
              );
            }
            this.logger.warn(
              `Stripe event ${event.id}: PaymentIntent ${intentId} is not one of ours; ignored`,
            );
            return null;
          }
          assertSameAmount(event, payment);
          if (payment.status !== PaymentStatus.Succeeded) {
            if (payment.status === PaymentStatus.Canceled) {
              this.logger.warn(
                `Payment ${payment.id as string} was CANCELED but Stripe captured it`,
              );
            }
            await this.payments
              .updateOne(
                { _id: payment._id },
                {
                  $set: { status: PaymentStatus.Succeeded },
                  $unset: { lastError: 1 },
                },
                { session },
              )
              .exec();
          }
          try {
            await this.payable(payment.bookingType).markConfirmed(
              payment.bookingId.toHexString(),
              { paymentId: payment.id as string },
              session,
            );
            return null;
          } catch (e) {
            if (
              !(e instanceof AppException) ||
              !REFUNDABLE_CODES.includes(e.code)
            ) {
              throw e;
            }
            await this.recordLateRefund(payment, session);
            return payment._id;
          }
        });
        break;
      } catch (e) {
        // A booking reference collision aborts the transaction and withTransaction does not retry it.
        if (!isReferenceCollision(e) || attempt === CONFIRM_ATTEMPTS) throw e;
      }
    }
    if (refundFor) {
      const refund = await this.refunds
        .findOne({ paymentId: refundFor })
        .exec();
      if (refund) await this.requestRefund(refund);
    }
  }

  /**
   * payment_failed for the current attempt: FAILED with Stripe's message, so the user can retry. An event
   * created before the current attempt started (Stripe does not guarantee order) is stale and ignored.
   */
  private async onFailed(event: StripeWebhookEvent): Promise<void> {
    const intentId = event.data.object.id!;
    const reason = (
      event.data.object.last_payment_error?.message ?? 'The payment failed'
    ).slice(0, MAX_ERROR_LENGTH);
    // Stripe's `created` is in whole seconds: any event from the attempt's second onwards counts.
    const createdBefore = new Date(
      (Math.floor(event.created ?? Date.now() / 1000) + 1) * 1000,
    );
    const failed = await this.inTransaction(event, (session) =>
      this.payments
        .findOneAndUpdate(
          {
            stripePaymentIntentId: intentId,
            status: { $in: OPEN },
            attemptStartedAt: { $lt: createdBefore },
          },
          { $set: { status: PaymentStatus.Failed, lastError: reason } },
          { new: true, session },
        )
        .exec(),
    );
    if (!failed) {
      this.logger.log(
        `Stripe event ${event.id}: payment_failed for ${intentId} is stale or not for an open payment; ignored`,
      );
      return;
    }
    // Informational only (the payments collection is the record); the booking stays Pending Payment.
    await this.payable(failed.bookingType)
      .markPaymentFailed(failed.bookingId.toHexString(), {
        paymentId: failed.id as string,
        reason,
      })
      .catch((e: unknown) =>
        this.logger.error(
          `Payment ${failed.id as string} failed but its booking could not be told`,
          e instanceof Error ? e.stack : String(e),
        ),
      );
  }

  /** Records the event id and applies `work` in one transaction; a recorded id means a replay. */
  private async inTransaction<T>(
    event: StripeWebhookEvent,
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let result!: T;
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
        result = await work(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  /** The full refund owed for a payment whose booking can't be confirmed, keyed by the payment. */
  private async recordLateRefund(
    payment: PaymentDocument,
    session: ClientSession,
  ): Promise<void> {
    await this.refunds
      .updateOne(
        { paymentId: payment._id },
        {
          $setOnInsert: {
            bookingType: payment.bookingType,
            bookingId: payment.bookingId,
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

  /**
   * Asks Stripe for a recorded late refund (idempotent per payment). Failures leave it PENDING without a
   * Stripe id, and `retryPendingRefunds` sends it again.
   */
  private async requestRefund(refund: RefundDocument): Promise<boolean> {
    const payment = await this.payments.findById(refund.paymentId).exec();
    if (!payment) {
      this.logger.error(
        `Refund ${refund.id as string}: its payment is missing`,
      );
      return false;
    }
    let stripeRefundId: string;
    try {
      stripeRefundId = (
        await this.stripe.createRefund({
          paymentIntentId: payment.stripePaymentIntentId,
          metadata: { paymentId: payment.id as string, reason: refund.reason },
          idempotencyKey: `late-refund:${payment.id as string}`,
        })
      ).id;
    } catch (e) {
      this.logger.error(
        `Refund ${refund.id as string} for payment ${payment.id as string} could not be requested; retried by the job`,
        e instanceof Error ? e.stack : String(e),
      );
      return false;
    }
    const res = await this.refunds
      .updateOne({ _id: refund._id }, { $set: { stripeRefundId } })
      .exec();
    if (res.matchedCount !== 1) {
      this.logger.error(
        `Stripe refund ${stripeRefundId} was created but refund ${refund.id as string} could not be updated`,
      );
      return false;
    }
    this.logger.warn(
      `Payment ${payment.id as string} of ${payment.bookingType} booking ${payment.bookingId.toHexString()} could not confirm the booking; refunded in full (${stripeRefundId})`,
    );
    return true;
  }

  /* ------------------------------------- jobs ------------------------------------- */

  /** Re-sends late refunds that Stripe does not have yet (no Stripe id). */
  async retryPendingRefunds(): Promise<number> {
    const pending = await this.refunds
      .find({
        reason: RefundReason.HoldExpired,
        status: RefundStatus.Pending,
        stripeRefundId: { $exists: false },
      })
      .sort({ createdAt: 1 })
      .limit(JOB_BATCH)
      .exec();
    let sent = 0;
    for (const refund of pending) {
      if (await this.requestRefund(refund)) sent += 1;
    }
    return sent;
  }

  /**
   * PAY-01: when the hold has expired, its PaymentIntent is cancelled so it can no longer be paid.
   * - A capture Stripe already made is applied as the succeeded webhook would (the booking can't be
   *   confirmed any more, so it is refunded).
   * - A PaymentIntent Stripe no longer has is closed.
   * - Anything else unsettled is checked again later with a growing delay, so it never blocks the batch.
   */
  async cancelExpiredIntents(now: Date = new Date()): Promise<number> {
    const due = await this.payments
      .find({
        status: { $in: OPEN },
        holdEndsAt: { $lte: now },
        $or: [{ nextCheckAt: null }, { nextCheckAt: { $lte: now } }],
      })
      .sort({ holdEndsAt: 1 })
      .limit(JOB_BATCH)
      .exec();
    let cancelled = 0;
    for (const payment of due) {
      try {
        const status = await this.cancelOrInspect(payment);
        if (status === 'canceled' || status === 'missing') {
          const res = await this.payments
            .updateOne(
              { _id: payment._id, status: { $in: OPEN } },
              { $set: { status: PaymentStatus.Canceled } },
            )
            .exec();
          cancelled += res.modifiedCount;
          if (status === 'missing') {
            this.logger.error(
              `Payment ${payment.id as string}: Stripe has no PaymentIntent ${payment.stripePaymentIntentId}; closed`,
            );
          }
        } else if (status === 'succeeded') {
          await this.onSucceeded(reconcileEvent(payment));
        } else {
          await this.backOff(payment, now, `Stripe reports ${status}`);
        }
      } catch (e) {
        if (e instanceof EventReplay) continue;
        await this.backOff(
          payment,
          now,
          e instanceof Error ? e.message : String(e),
        );
      }
    }
    return cancelled;
  }

  private async cancelOrInspect(
    payment: PaymentDocument,
  ): Promise<IntentStatus | 'missing'> {
    try {
      return (
        await this.stripe.cancelPaymentIntent(payment.stripePaymentIntentId)
      ).status;
    } catch (e) {
      if (!(e instanceof StripeApiError)) throw e;
      if (e.code === 'resource_missing') return 'missing';
      if (e.code !== 'payment_intent_unexpected_state') throw e;
      return (
        await this.stripe.retrievePaymentIntent(payment.stripePaymentIntentId)
      ).status;
    }
  }

  private async backOff(
    payment: PaymentDocument,
    now: Date,
    why: string,
  ): Promise<void> {
    const delay = Math.min(60_000 * 2 ** payment.checkAttempts, MAX_BACKOFF_MS);
    this.logger.warn(
      `Payment ${payment.id as string}: hold expired but its PaymentIntent is not settled (${why}); checked again in ${delay / 60_000} min`,
    );
    await this.payments
      .updateOne(
        { _id: payment._id },
        {
          $set: { nextCheckAt: new Date(now.getTime() + delay) },
          $inc: { checkAttempts: 1 },
        },
      )
      .exec();
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

  /**
   * The DTO, with the client secret only for the owner, while the payment is open and its hold has time
   * left. A Stripe outage just leaves the secret out (the rest is local data).
   */
  private async view(
    payment: PaymentDocument,
    reference: string | null,
    owner: boolean,
    now: Date,
  ): Promise<PaymentDto> {
    if (!owner || !OPEN.includes(payment.status) || payment.holdEndsAt <= now) {
      return toDto(payment, reference);
    }
    try {
      const intent = await this.stripe.retrievePaymentIntent(
        payment.stripePaymentIntentId,
      );
      return toDto(payment, reference, intent.clientSecret);
    } catch (e) {
      this.logger.error(
        `Payment ${payment.id as string}: client secret unavailable (${e instanceof Error ? e.message : String(e)})`,
      );
      return toDto(payment, reference);
    }
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

/** A synthetic succeeded event for a capture the cancel job found before its webhook (stable id). */
function reconcileEvent(payment: PaymentDocument): StripeWebhookEvent {
  return {
    id: `evt_reconcile_${payment.stripePaymentIntentId}`,
    type: 'payment_intent.succeeded',
    data: {
      object: { id: payment.stripePaymentIntentId, object: 'payment_intent' },
    },
  };
}

/** The captured amount and currency must be the ones recorded (a mismatch is a loud defect, 5xx). */
function assertSameAmount(
  event: StripeWebhookEvent,
  payment: PaymentDocument,
): void {
  const o = event.data.object;
  const amount = o.amount_received ?? o.amount;
  const amountOff =
    typeof amount === 'number' && amount !== payment.amountMinor;
  const currencyOff =
    typeof o.currency === 'string' &&
    o.currency.toUpperCase() !== payment.currency;
  if (amountOff || currencyOff) {
    throw new Error(
      `PaymentIntent ${payment.stripePaymentIntentId} captured ${amount} ${o.currency} but payment ${payment.id as string} expects ${payment.amountMinor} ${payment.currency}`,
    );
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
  const valid =
    !!event &&
    typeof event.id === 'string' &&
    event.id.startsWith('evt_') &&
    typeof event.type === 'string' &&
    typeof event.data?.object === 'object' &&
    event.data.object !== null &&
    // Every payment_intent.* event must name its PaymentIntent.
    (!event.type.startsWith('payment_intent.') ||
      (typeof event.data.object.id === 'string' &&
        event.data.object.id.startsWith('pi_')));
  if (!valid) {
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

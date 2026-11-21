import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { assertOwner } from '../../common/auth/access';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import {
  BookingType,
  computeRefundQuote,
  NOTIFICATIONS_SERVICE,
  NotificationType,
  RefundReason,
  RefundStatus,
  type NotificationInput,
  type NotificationsService,
  type RefundQuote,
  type RefundQuoteInput,
  type RefundRecord,
  type RefundRequest,
  type RefundsService,
  type RefundSummary,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { formatMinor } from '../../common/utils/money';
import {
  NodeEnv,
  type EnvironmentVariables,
} from '../../config/env.validation';
import type { RefundDto } from './dto/refund.dto';
import {
  Payment,
  PaymentStatus,
  type PaymentDocument,
} from './schemas/payment.schema';
import { Refund, type RefundDocument } from './schemas/refund.schema';
import {
  STRIPE_GATEWAY,
  StripeApiError,
  type RefundInfo,
  type StripeGateway,
  type StripeWebhookEvent,
} from './stripe-gateway';
import { runInTransaction } from '../../common/utils/transaction';

/** The dispatcher's batch size. */
const BATCH = 100;
/** Back-off for a refund Stripe did not take: 1, 2, 4 ... minutes, at most an hour. */
const MAX_BACKOFF_MS = 60 * 60_000;
/** The outbox kick runs this long after refundFor, well after the caller's transaction commits. */
const KICK_DELAY_MS = 1_000;
const DUPLICATE_KEY = 11000;
const NOT_FOUND_MESSAGE = 'Refund not found';

/** The refund events the webhook applies (PAY-03). */
export const REFUND_EVENTS: readonly string[] = [
  'refund.created',
  'refund.updated',
  'refund.failed',
];

/**
 * Refund refusals that are about this charge, not our setup: sending the refund again can never succeed.
 * Anything else (a revoked key, missing permissions, an outage) leaves the refund PENDING for the job.
 */
const TERMINAL_REFUND_CODES = new Set([
  'charge_already_refunded',
  'charge_disputed',
  'charge_expired_for_capture',
]);

/**
 * PAY-03 / PAY-04 (TRVL-69, TRVL-109, TRVL-161): REFUNDS_SERVICE.
 *
 * Transactional outbox (ADR-0003 amendment): `refundFor` only writes a PENDING refund and its
 * REFUND_ISSUED notification in the caller's session; Stripe is never called inside a transaction. The
 * dispatcher (kicked one second later, and every 60 s by the payments job) reads committed refunds only
 * and sends each to the Stripe Refunds API under an idempotency key. Stripe's answer and the
 * refund.* webhooks settle a refund PENDING -> REFUNDED | FAILED with ONE conditional update, so it is
 * settled, and the user notified, exactly once whatever the order or replays.
 */
@Injectable()
export class RefundsServiceImpl
  implements RefundsService, OnApplicationShutdown
{
  private readonly logger = new Logger(RefundsServiceImpl.name);
  private kick?: NodeJS.Timeout;

  constructor(
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
    @Inject(NOTIFICATIONS_SERVICE)
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  onApplicationShutdown(): void {
    if (this.kick) clearTimeout(this.kick);
    this.kick = undefined;
  }

  /* --------------------------------- REFUNDS_SERVICE contract --------------------------------- */

  quote(input: RefundQuoteInput): RefundQuote {
    return computeRefundQuote(input);
  }

  async refundFor(
    request: RefundRequest,
    session?: ClientSession,
  ): Promise<RefundRecord | null> {
    const { quote } = request;
    // Only a positive amount is a refund (PAY-03): nothing is recorded or sent for 0%.
    if (quote.amountMinor === 0) return null;
    const what = `${request.bookingType} booking ${request.bookingId}`;
    const currency = this.platformCurrency();
    if (quote.currency !== currency) {
      throw new Error(
        `PAY-04: the refund for ${what} is in ${quote.currency}, not the platform currency ${currency}`,
      );
    }
    if (!Number.isSafeInteger(quote.amountMinor) || quote.amountMinor < 0) {
      throw new Error(
        `The refund for ${what} must be whole minor units, got ${quote.amountMinor}`,
      );
    }
    const payment = Types.ObjectId.isValid(request.paymentId)
      ? await this.payments
          .findById(request.paymentId, null, { session })
          .exec()
      : null;
    if (
      !payment ||
      payment.bookingType !== request.bookingType ||
      payment.bookingId.toHexString() !== request.bookingId ||
      payment.status !== PaymentStatus.Succeeded
    ) {
      throw new Error(
        `The refund for ${what} names payment ${request.paymentId}, which is not this booking's succeeded payment`,
      );
    }
    if (quote.amountMinor > payment.amountMinor) {
      throw new Error(
        `The refund for ${what} (${quote.amountMinor}) exceeds the ${payment.amountMinor} paid`,
      );
    }

    const forBooking = {
      bookingType: request.bookingType,
      bookingId: new Types.ObjectId(request.bookingId),
    };
    let inserted = false;
    try {
      const res = await this.refunds
        .updateOne(
          forBooking,
          {
            $setOnInsert: {
              paymentId: payment._id,
              userId: payment.userId,
              amountMinor: quote.amountMinor,
              currency: quote.currency,
              refundPercent: quote.refundPercent,
              tierApplied: quote.tierApplied
                ? {
                    daysBefore: quote.tierApplied.daysBefore,
                    percent: quote.tierApplied.refundPercent,
                  }
                : null,
              reason: request.reason,
              status: RefundStatus.Pending,
            },
          },
          { upsert: true, session },
        )
        .exec();
      inserted = res.upsertedCount === 1;
    } catch (e) {
      // Outside a transaction a concurrent first call may win the unique index: return its record.
      if (session || (e as { code?: number }).code !== DUPLICATE_KEY) throw e;
    }
    const refund = await this.refunds
      .findOne(forBooking, null, { session })
      .exec();
    if (!refund) {
      throw new Error(`The refund for ${what} was written but cannot be read`);
    }
    if (inserted) {
      await this.notifications.notify(issuedNotice(refund), session);
      this.kickDispatcher();
    }
    return {
      refundId: refund.id as string,
      status: refund.status,
      amountMinor: refund.amountMinor,
    };
  }

  async summaryFor(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<RefundSummary | null> {
    if (!Types.ObjectId.isValid(bookingId)) return null;
    const refund = await this.refunds
      .findOne({ bookingType, bookingId: new Types.ObjectId(bookingId) })
      .exec();
    return refund
      ? {
          id: refund.id as string,
          status: refund.status,
          amountMinor: refund.amountMinor,
          currency: refund.currency,
        }
      : null;
  }

  /** GET /api/refunds/:id: the owner or an admin; anyone else gets the 404 of an unknown id (ACC-11). */
  async findForUser(user: AuthUser, id: string): Promise<RefundDto> {
    const refund = Types.ObjectId.isValid(id)
      ? await this.refunds.findById(id).exec()
      : null;
    if (!refund) throw notFound();
    assertOwner(user, refund.userId, {
      bypassRoles: [Role.Admin],
      notFound: true,
      notFoundMessage: NOT_FOUND_MESSAGE,
    });
    return toDto(refund);
  }

  /* ------------------------------------- late refunds ------------------------------------- */

  /**
   * PAY-01 (ADR-0003): the full refund owed for a payment whose booking can't be confirmed, keyed by the
   * payment, written in the webhook's transaction with its REFUND_ISSUED notice (once, on insert).
   */
  async recordLateRefund(
    payment: PaymentDocument,
    session: ClientSession,
  ): Promise<void> {
    const res = await this.refunds
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
    if (res.upsertedCount === 1) {
      const refund = await this.refunds
        .findOne({ paymentId: payment._id }, null, { session })
        .exec();
      if (refund)
        await this.notifications.notify(issuedNotice(refund), session);
    }
  }

  /** After the webhook's commit: sends the late refund of this payment at once. */
  async sendLateRefund(paymentId: Types.ObjectId): Promise<void> {
    const refund = await this.refunds.findOne({ paymentId }).exec();
    if (refund?.status === RefundStatus.Pending && !refund.stripeRefundId) {
      await this.sendRefund(refund);
    }
  }

  /* --------------------------------------- dispatcher --------------------------------------- */

  /**
   * The outbox: sends every committed PENDING refund Stripe does not have yet (any reason) once its
   * back-off has passed. Returns how many Stripe accepted.
   */
  async dispatchPendingRefunds(now: Date = new Date()): Promise<number> {
    const pending = await this.refunds
      .find({
        status: RefundStatus.Pending,
        stripeRefundId: { $exists: false },
        $or: [
          { nextAttemptAt: { $exists: false } },
          { nextAttemptAt: { $lte: now } },
        ],
      })
      .sort({ createdAt: 1 })
      .limit(BATCH)
      .exec();
    let sent = 0;
    for (const refund of pending) {
      // One refund failing (e.g. its payment lookup throws) never stops the rest of the batch.
      try {
        if (await this.sendRefund(refund, now)) sent += 1;
      } catch (e) {
        this.logger.error(
          `Refund ${refund.id as string} could not be dispatched; the next run tries again`,
          e instanceof Error ? e.stack : String(e),
        );
      }
    }
    return sent;
  }

  /**
   * Asks Stripe for one refund (idempotent: `late-refund:<paymentId>` for HOLD_EXPIRED, unchanged since
   * PAY-01, otherwise `refund:<refundId>`) and applies the status Stripe answers at once. A refusal about
   * the charge closes it as FAILED; any other failure leaves it PENDING and backs it off.
   */
  async sendRefund(
    refund: RefundDocument,
    now: Date = new Date(),
  ): Promise<boolean> {
    const refundId = refund.id as string;
    const payment = await this.payments.findById(refund.paymentId).exec();
    if (!payment) {
      this.logger.error(`Refund ${refundId}: its payment is missing`);
      return false;
    }
    const paymentId = payment.id as string;
    const late = refund.reason === RefundReason.HoldExpired;
    let info: RefundInfo;
    try {
      info = await this.stripe.createRefund({
        paymentIntentId: payment.stripePaymentIntentId,
        // A late refund is the whole payment (Stripe's default), as it was first requested.
        ...(late ? {} : { amountMinor: refund.amountMinor }),
        // A late refund keeps PAY-01's exact request (key and metadata), so a refund already in flight
        // at Stripe under `late-refund:<paymentId>` is never answered with idempotency_error.
        metadata: late
          ? { paymentId, reason: refund.reason }
          : { refundId, paymentId, reason: refund.reason },
        idempotencyKey: late
          ? `late-refund:${paymentId}`
          : `refund:${refundId}`,
      });
    } catch (e) {
      if (e instanceof StripeApiError && isRefundTerminal(e)) {
        // This charge can never be refunded this way (e.g. already refunded): close it as FAILED, once.
        await this.settle(refund._id, RefundStatus.Failed, {
          // Stripe's code only: its text is never repeated (ADR-0003).
          failureReason: `stripe:${e.code ?? 'unknown'}`,
        });
        this.logger.error(
          `Refund ${refundId} for payment ${paymentId} was refused by Stripe (${e.httpStatus} ${e.code ?? ''}); marked FAILED`,
        );
        return false;
      }
      const delay = Math.min(
        60_000 * 2 ** (refund.sendAttempts ?? 0),
        MAX_BACKOFF_MS,
      );
      await this.refunds
        .updateOne(
          { _id: refund._id, status: RefundStatus.Pending },
          {
            $set: { nextAttemptAt: new Date(now.getTime() + delay) },
            $inc: { sendAttempts: 1 },
          },
        )
        .exec();
      this.logger.error(
        `Refund ${refundId} for payment ${paymentId} could not be requested; sent again in ${delay / 60_000} min`,
        e instanceof Error ? e.stack : String(e),
      );
      return false;
    }
    const status = fromStripe(info.status);
    await this.settle(refund._id, status, {
      stripeRefundId: info.id,
      ...(status === RefundStatus.Failed && {
        failureReason: `stripe:${info.failureReason ?? 'unknown'}`,
      }),
    });
    if (late) {
      this.logger.warn(
        `Payment ${paymentId} of ${payment.bookingType} booking ${payment.bookingId.toHexString()} could not confirm the booking; refunded in full (${info.id})`,
      );
    }
    return true;
  }

  /* ---------------------------------------- webhook ---------------------------------------- */

  /**
   * refund.created / refund.updated / refund.failed, inside the webhook's transaction (which also records
   * the event id, so a replay never gets here). The refund is found by its Stripe id or, when the
   * webhook beats the dispatcher saving that id, by metadata.refundId. Only a PENDING refund changes.
   */
  async applyRefundEvent(
    event: StripeWebhookEvent,
    session: ClientSession,
  ): Promise<void> {
    const o = event.data.object;
    const stripeRefundId = o.id!;
    let refund = await this.refunds
      .findOne({ stripeRefundId }, null, { session })
      .exec();
    const metaId = o.metadata?.refundId;
    if (!refund && metaId && Types.ObjectId.isValid(metaId)) {
      const byMeta = await this.refunds
        .findById(metaId, null, { session })
        .exec();
      // Another Stripe refund already belongs to it: this event is not about our refund.
      if (byMeta && !byMeta.stripeRefundId) refund = byMeta;
    }
    const metaPayment = o.metadata?.paymentId;
    if (
      !refund &&
      !metaId &&
      metaPayment &&
      Types.ObjectId.isValid(metaPayment)
    ) {
      // A late refund (PAY-01 metadata: paymentId and reason only) whose Stripe id is not saved yet.
      refund = await this.refunds
        .findOne(
          {
            paymentId: new Types.ObjectId(metaPayment),
            reason: RefundReason.HoldExpired,
            stripeRefundId: { $exists: false },
          },
          null,
          { session },
        )
        .exec();
    }
    if (!refund) {
      this.logger.warn(
        `Stripe event ${event.id}: refund ${stripeRefundId} is not one of ours; ignored`,
      );
      return;
    }
    const status =
      event.type === 'refund.failed'
        ? RefundStatus.Failed
        : fromStripe(o.status);
    if (!refund.stripeRefundId) {
      await this.refunds
        .updateOne(
          { _id: refund._id },
          { $set: { stripeRefundId } },
          { session },
        )
        .exec();
    }
    if (status === RefundStatus.Pending) return;
    if (refund.status !== RefundStatus.Pending && refund.status !== status) {
      // Only a PENDING refund changes (PAY-03), but Stripe contradicting a settled refund (e.g. failing
      // one we showed as REFUNDED) means money may not have moved: loud, for a person to check.
      // Stripe's code only, never its message.
      this.logger.error(
        `Refund ${refund.id as string} (Stripe ${stripeRefundId}) is ${refund.status} but Stripe event ${event.id} reports ${status}${status === RefundStatus.Failed ? ` (stripe:${o.failure_reason ?? 'unknown'})` : ''}; left unchanged, needs a manual check`,
      );
      return;
    }
    await this.settleIn(
      session,
      refund._id,
      status,
      status === RefundStatus.Failed
        ? `stripe:${o.failure_reason ?? 'unknown'}`
        : undefined,
    );
  }

  /* ---------------------------------------- helpers ---------------------------------------- */

  /**
   * Saves Stripe's id and, for a final status, moves the refund out of PENDING with its notice, in one
   * transaction. The update is conditional on PENDING, so a refund already settled by a webhook is left
   * alone and nobody is notified twice.
   */
  private async settle(
    id: Types.ObjectId,
    status: RefundStatus,
    fields: { stripeRefundId?: string; failureReason?: string },
  ): Promise<void> {
    await runInTransaction(this.connection, async (session) => {
      if (fields.stripeRefundId) {
        const res = await this.refunds
          .updateOne(
            { _id: id },
            { $set: { stripeRefundId: fields.stripeRefundId } },
            { session },
          )
          .exec();
        if (res.matchedCount !== 1) {
          this.logger.error(
            `Stripe refund ${fields.stripeRefundId} was created but refund ${id.toHexString()} could not be updated`,
          );
        }
      }
      if (status !== RefundStatus.Pending) {
        await this.settleIn(session, id, status, fields.failureReason);
      }
    });
  }

  private async settleIn(
    session: ClientSession,
    id: Types.ObjectId,
    status: RefundStatus,
    failureReason: string | undefined,
  ): Promise<void> {
    const updated = await this.refunds
      .findOneAndUpdate(
        { _id: id, status: RefundStatus.Pending },
        { $set: { status, ...(failureReason && { failureReason }) } },
        { new: true, session },
      )
      .exec();
    if (updated) {
      await this.notifications.notify(updatedNotice(updated), session);
    }
  }

  /** One pending kick at a time; never in tests (they call the dispatcher with a fixed time). */
  private kickDispatcher(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === NodeEnv.Test) return;
    if (this.kick) return;
    this.kick = setTimeout(() => {
      this.kick = undefined;
      this.dispatchPendingRefunds().catch((e: unknown) =>
        this.logger.error(
          'Dispatching pending refunds failed; the payments job retries them',
          e instanceof Error ? e.stack : String(e),
        ),
      );
    }, KICK_DELAY_MS);
    this.kick.unref();
  }

  private platformCurrency(): string {
    return this.config.get('PLATFORM_CURRENCY', { infer: true });
  }
}

function isRefundTerminal(e: StripeApiError): boolean {
  return e.code !== null && TERMINAL_REFUND_CODES.has(e.code);
}

/** Stripe refund status -> ours; pending and requires_action (and anything new) stay PENDING. */
function fromStripe(status: string | undefined): RefundStatus {
  if (status === 'succeeded') return RefundStatus.Refunded;
  if (status === 'failed' || status === 'canceled') return RefundStatus.Failed;
  return RefundStatus.Pending;
}

function what(refund: RefundDocument): string {
  return refund.bookingType === BookingType.Flight
    ? 'flight booking'
    : 'hotel reservation';
}

function link(refund: RefundDocument): string {
  const id = refund.bookingId.toHexString();
  return refund.bookingType === BookingType.Flight
    ? `/bookings/flights/${id}`
    : `/bookings/hotels/${id}`;
}

function money(refund: RefundDocument): string {
  return `${formatMinor(refund.amountMinor, refund.currency)} ${refund.currency}`;
}

function issuedNotice(refund: RefundDocument): NotificationInput {
  return {
    userId: refund.userId.toHexString(),
    type: NotificationType.RefundIssued,
    title: 'Refund issued',
    body: `A refund of ${money(refund)} (${refund.refundPercent}%) for your ${what(refund)} has been issued. Its status is Pending until the payment provider completes it.`,
    link: link(refund),
  };
}

function updatedNotice(refund: RefundDocument): NotificationInput {
  const done = refund.status === RefundStatus.Refunded;
  return {
    userId: refund.userId.toHexString(),
    type: NotificationType.RefundUpdated,
    title: done ? 'Refund completed' : 'Refund failed',
    body: done
      ? `Your refund of ${money(refund)} for your ${what(refund)} has been completed.`
      : `Your refund of ${money(refund)} for your ${what(refund)} could not be completed. Please contact support.`,
    link: link(refund),
  };
}

function notFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    NOT_FOUND_MESSAGE,
  );
}

function toDto(r: RefundDocument): RefundDto {
  return {
    id: r.id as string,
    bookingType: r.bookingType,
    bookingId: r.bookingId.toHexString(),
    amountMinor: r.amountMinor,
    currency: r.currency,
    refundPercent: r.refundPercent,
    tierApplied: r.tierApplied
      ? {
          daysBefore: r.tierApplied.daysBefore,
          refundPercent: r.tierApplied.percent,
        }
      : null,
    reason: r.reason,
    status: r.status,
    ...(r.failureReason && { failureReason: r.failureReason }),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

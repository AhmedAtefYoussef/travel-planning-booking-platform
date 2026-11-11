import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { assertOwner } from '../../common/auth/access';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import {
  BookingType,
  computeRefundQuote,
  NOTIFICATIONS_SERVICE,
  NotificationType,
  RefundStatus,
  type NotificationsService,
  type RefundQuote,
  type RefundQuoteInput,
  type RefundRecord,
  type RefundRequest,
  type RefundsService,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { formatMinor } from '../../common/utils/money';
import {
  NodeEnv,
  type EnvironmentVariables,
} from '../../config/env.validation';
import type { RefundDto } from './dto/refund.dto';
import { Payment, PaymentStatus } from './schemas/payment.schema';
import { Refund, type RefundDocument } from './schemas/refund.schema';
import {
  PaymentProviderError,
  STRIPE_GATEWAY,
  type GatewayEvent,
  type StripeGateway,
} from './stripe.gateway';

/** How often unsent refunds are (re)sent to Stripe. */
export const REFUND_SWEEP_INTERVAL_MS = 60_000;
const SWEEP_BATCH = 50;

/** Stripe refund status -> our status (PAY-03: Pending, Refunded, Failed). */
export function toRefundStatus(stripeStatus: string | undefined): RefundStatus {
  if (stripeStatus === 'succeeded') return RefundStatus.Refunded;
  if (stripeStatus === 'failed' || stripeStatus === 'canceled') {
    return RefundStatus.Failed;
  }
  return RefundStatus.Pending;
}

const isDuplicateBookingRefund = (e: unknown) =>
  (e as { code?: number }).code === 11000 &&
  'bookingId' in ((e as { keyPattern?: object }).keyPattern ?? {});

/**
 * PAY-03 refunds, exposed as REFUNDS_SERVICE to the cancellation features (FLT-26, HTL-21, FLT-06).
 *
 * Outbox pattern: refundFor only RECORDS a PENDING refund, inside the caller's cancellation
 * transaction when one is given. The Stripe Refunds API is called after that commit (at once when
 * there is no transaction, otherwise by the sweep within a minute), so a cancellation that rolls
 * back never sends money, and a Stripe outage only delays the refund. The idempotency key per refund
 * record means a retried call can never refund twice. Stripe's webhook then moves the refund to
 * REFUNDED or FAILED; the user is notified when it is issued and when it changes (GEN-01).
 */
@Injectable()
export class StripeRefundsService
  implements RefundsService, OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(StripeRefundsService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<unknown>;

  constructor(
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    @Optional()
    @Inject(NOTIFICATIONS_SERVICE)
    private readonly notifications?: NotificationsService,
  ) {}

  /** Pure calculation (FLT-09 tiers on the booking snapshot; provider cancellations 100%). */
  quote(input: RefundQuoteInput): RefundQuote {
    return computeRefundQuote(input);
  }

  /**
   * Records the refund of a cancellation. Returns null when the quote is 0 (nothing to refund).
   * Calling it again for the same booking returns the existing refund (one per booking).
   */
  async refundFor(
    request: RefundRequest,
    session?: ClientSession,
  ): Promise<RefundRecord | null> {
    const { quote } = request;
    if (quote.amountMinor <= 0) return null;
    const payment = Types.ObjectId.isValid(request.paymentId)
      ? await this.payments
          .findById(request.paymentId)
          .session(session ?? null)
          .exec()
      : null;
    if (
      !payment ||
      payment.status !== PaymentStatus.Succeeded ||
      payment.bookingType !== request.bookingType ||
      payment.bookingId.toHexString() !== request.bookingId
    ) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        'This booking has no successful payment to refund',
      );
    }
    if (
      quote.amountMinor > payment.amountMinor ||
      quote.currency !== payment.currency
    ) {
      // Never refund more than was paid, or in another currency (PAY-04).
      throw new Error(
        `Refund of ${quote.amountMinor} ${quote.currency} does not fit payment ${payment.amountMinor} ${payment.currency}`,
      );
    }

    // One refund per booking: a repeated call returns it (inside a transaction a duplicate-key error
    // would abort the caller's whole cancellation, so look first).
    const existing = await this.findForBooking(request, session);
    if (existing) return toRecord(existing);

    let refund: RefundDocument;
    try {
      [refund] = await this.refunds.create(
        [
          {
            paymentId: payment._id,
            bookingType: request.bookingType,
            bookingId: new Types.ObjectId(request.bookingId),
            userId: new Types.ObjectId(request.userId),
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
        ],
        { session },
      );
    } catch (e) {
      // Two calls without a transaction racing: the loser returns the winner's refund.
      if (!isDuplicateBookingRefund(e) || session) throw e;
      const winner = await this.findForBooking(request);
      if (!winner) throw e;
      return toRecord(winner);
    }
    if (!session) await this.send(refund);
    return toRecord(refund);
  }

  /** Sends every recorded refund that Stripe has not accepted yet; returns how many were sent. */
  async issuePending(): Promise<number> {
    const pending = await this.refunds
      .find({
        status: RefundStatus.Pending,
        stripeRefundId: { $exists: false },
      })
      // Never tried first, then least recently tried: a refund that keeps failing cannot hold up the rest.
      .sort({ lastSendAttemptAt: 1, createdAt: 1 })
      .limit(SWEEP_BATCH)
      .exec();
    let sent = 0;
    for (const refund of pending) {
      if (await this.send(refund)) sent += 1;
    }
    return sent;
  }

  /**
   * Webhook part (refund.created, refund.updated, refund.failed, charge.refund.updated), inside the
   * webhook transaction. The refund is found by its Stripe id, or by our record id in the refund's
   * metadata when the event arrives before the Stripe id was stored. PENDING -> REFUNDED | FAILED;
   * REFUNDED -> FAILED too, since Stripe can still fail a refund it reported as succeeded.
   * Returns the refund when its status changed.
   */
  async applyStripeStatus(
    event: GatewayEvent,
    session: ClientSession,
  ): Promise<RefundDocument | null> {
    const stripeRefundId = event.object.id;
    if (!/^re_/.test(stripeRefundId)) return null;
    const recordId = event.object.refundRecordId;
    const match = [
      { stripeRefundId },
      ...(recordId && Types.ObjectId.isValid(recordId)
        ? [
            {
              _id: new Types.ObjectId(recordId),
              stripeRefundId: { $exists: false },
            },
          ]
        : []),
    ];
    const status = toRefundStatus(event.object.status);
    if (status === RefundStatus.Pending) {
      // Nothing to report yet; just remember which Stripe refund this is.
      await this.refunds
        .updateOne(
          { $or: match, status: RefundStatus.Pending },
          { $set: { stripeRefundId } },
          { session },
        )
        .exec();
      return null;
    }
    const changed = await this.refunds
      .findOneAndUpdate(
        {
          $or: match,
          status:
            status === RefundStatus.Failed
              ? { $in: [RefundStatus.Pending, RefundStatus.Refunded] }
              : RefundStatus.Pending,
        },
        {
          $set: {
            stripeRefundId,
            status,
            ...(status === RefundStatus.Failed
              ? { failureReason: failureText(event.object.failureReason) }
              : {}),
          },
        },
        { new: true, session },
      )
      .exec();
    if (!changed) {
      this.logger.log(
        `Refund event ${event.id} (${stripeRefundId}: ${event.object.status ?? '?'}) changed nothing`,
      );
    }
    return changed;
  }

  /** After the webhook commits: tell the user the refund's new status (GEN-01). */
  async notifyStatus(refund: RefundDocument): Promise<void> {
    await this.notify(
      refund,
      NotificationType.RefundUpdated,
      refund.status === RefundStatus.Refunded
        ? 'Your refund was completed'
        : 'Your refund could not be completed',
      refund.status === RefundStatus.Refunded
        ? `${formatMinor(refund.amountMinor, refund.currency)} ${refund.currency} is back on your card.`
        : `The refund of ${formatMinor(refund.amountMinor, refund.currency)} ${refund.currency} failed; our team will contact you.`,
    );
  }

  /** GET /api/refunds/:id: the refund owner, or an admin. */
  async findForUser(user: AuthUser, id: string): Promise<RefundDto> {
    const refund = Types.ObjectId.isValid(id)
      ? await this.refunds.findById(id).exec()
      : null;
    if (!refund) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Refund not found',
      );
    }
    assertOwner(user, refund.userId, { bypassRoles: [Role.Admin] });
    return toRefundDto(refund);
  }

  onApplicationBootstrap(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === NodeEnv.Test) return;
    const run = () => {
      this.running = this.issuePending().catch((e: unknown) =>
        this.logger.error(
          `Refund sweep failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    };
    run();
    this.timer = setInterval(run, REFUND_SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  private findForBooking(
    request: Pick<RefundRequest, 'bookingType' | 'bookingId'>,
    session?: ClientSession,
  ): Promise<RefundDocument | null> {
    return this.refunds
      .findOne({
        bookingType: request.bookingType,
        bookingId: new Types.ObjectId(request.bookingId),
      })
      .session(session ?? null)
      .exec();
  }

  /**
   * Tries to send one recorded refund; never throws. Returns true when Stripe accepted it. A request
   * Stripe rejects outright (e.g. the charge is already refunded) can never succeed, so the refund
   * becomes FAILED and the user is told; any other error is retried by the next sweep.
   */
  private async send(refund: RefundDocument): Promise<boolean> {
    try {
      await this.issue(refund);
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (e instanceof PaymentProviderError && !e.retryable) {
        this.logger.error(
          `Stripe rejected refund ${refund.id as string}; marked FAILED: ${message}`,
        );
        const failed = await this.refunds
          .findOneAndUpdate(
            {
              _id: refund._id,
              status: RefundStatus.Pending,
              stripeRefundId: { $exists: false },
            },
            {
              $set: {
                status: RefundStatus.Failed,
                failureReason: failureText(message),
              },
            },
            { new: true },
          )
          .exec()
          .catch(() => null);
        if (failed) await this.notifyStatus(failed);
        return false;
      }
      this.logger.warn(
        `Sending refund ${refund.id as string} to Stripe failed, retried next run: ${message}`,
      );
      await this.refunds
        .updateOne(
          { _id: refund._id },
          {
            $set: { lastSendAttemptAt: new Date() },
            $inc: { sendAttempts: 1 },
          },
        )
        .exec()
        .catch(() => undefined);
      return false;
    }
  }

  /** Stripe Refunds API call for one recorded refund; idempotent per refund record. */
  private async issue(refund: RefundDocument): Promise<void> {
    const payment = await this.payments.findById(refund.paymentId).exec();
    if (!payment)
      throw new Error(`Payment ${refund.paymentId.toHexString()} not found`);
    const result = await this.stripe.createRefund({
      paymentIntentId: payment.stripePaymentIntentId,
      amountMinor: refund.amountMinor,
      metadata: {
        refundId: refund.id as string,
        bookingType: refund.bookingType,
        bookingId: refund.bookingId.toHexString(),
        reason: refund.reason,
      },
      idempotencyKey: `refund-${refund.id as string}`,
    });
    const status = toRefundStatus(result.status);
    // Still PENDING, and not yet bound to another Stripe refund. A webhook may already have bound this
    // one (same id) while we waited; if it also set the final status, it told the user already.
    const updated = await this.refunds
      .findOneAndUpdate(
        {
          _id: refund._id,
          status: RefundStatus.Pending,
          $or: [
            { stripeRefundId: { $exists: false } },
            { stripeRefundId: result.id },
          ],
        },
        {
          $set: {
            stripeRefundId: result.id,
            status,
            ...(status === RefundStatus.Failed
              ? { failureReason: failureText(result.failureReason) }
              : {}),
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) return;
    if (status === RefundStatus.Failed) {
      await this.notifyStatus(updated);
      return;
    }
    await this.notify(
      updated,
      NotificationType.RefundIssued,
      status === RefundStatus.Refunded
        ? 'Your refund was completed'
        : 'Your refund is on its way',
      `${formatMinor(updated.amountMinor, updated.currency)} ${updated.currency} (${updated.refundPercent}% of your payment) is being returned to your card.`,
    );
  }

  private async notify(
    refund: RefundDocument,
    type: NotificationType,
    title: string,
    body: string,
  ): Promise<void> {
    if (!this.notifications) return;
    try {
      await this.notifications.notify({
        userId: refund.userId.toHexString(),
        type,
        title,
        body,
        link: `/bookings/${refund.bookingType === BookingType.Flight ? 'flights' : 'hotels'}/${refund.bookingId.toHexString()}`,
      });
    } catch (e) {
      this.logger.warn(
        `Refund notification failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

const failureText = (reason: string | null | undefined) =>
  (reason || 'failed').slice(0, 500);

function toRecord(refund: RefundDocument): RefundRecord {
  return {
    refundId: refund.id as string,
    status: refund.status,
    amountMinor: refund.amountMinor,
  };
}

export function toRefundDto(refund: RefundDocument): RefundDto {
  return {
    id: refund.id as string,
    bookingType: refund.bookingType,
    bookingId: refund.bookingId.toHexString(),
    paymentId: refund.paymentId.toHexString(),
    amountMinor: refund.amountMinor,
    currency: refund.currency,
    refundPercent: refund.refundPercent,
    tierApplied: refund.tierApplied
      ? {
          daysBefore: refund.tierApplied.daysBefore,
          refundPercent: refund.tierApplied.percent,
        }
      : null,
    reason: refund.reason,
    status: refund.status,
    stripeRefundId: refund.stripeRefundId ?? null,
    failureReason: refund.failureReason ?? null,
    createdAt: refund.createdAt,
    updatedAt: refund.updatedAt,
  };
}

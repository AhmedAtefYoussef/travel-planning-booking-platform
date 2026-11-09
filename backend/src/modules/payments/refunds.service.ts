import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Stripe from 'stripe';
import {
  BookingType,
  type PayableBooking,
} from '../../common/contracts/booking.contract';
import type { NotificationsService } from '../../common/contracts/notifications.contract';
import { PaymentStatus } from '../../common/contracts/payments.contract';
import type { PolicySnapshot } from '../../common/contracts/policies.contract';
import {
  RefundQuote,
  RefundReason,
  RefundRecord,
  RefundStatus,
  RefundsService as RefundsServiceContract,
} from '../../common/contracts/refunds.contract';
import {
  NOTIFICATIONS_SERVICE,
  PAYABLE_BOOKING,
} from '../../common/contracts/tokens';
import { daysRemaining } from '../../common/utils/dates';
import {
  MinorUnits,
  minorToDecimalString,
  percentOfMinor,
} from '../../common/utils/money';
import { Payment, PaymentDocument, Refund, RefundDocument } from './schemas';
import { STRIPE_CLIENT } from './stripe.provider';

@Injectable()
export class RefundsService implements RefundsServiceContract {
  constructor(
    @InjectModel(Refund.name) private readonly refunds: Model<RefundDocument>,
    @InjectModel(Payment.name)
    private readonly payments: Model<PaymentDocument>,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    @Inject(PAYABLE_BOOKING) private readonly bookings: PayableBooking,
    @Inject(NOTIFICATIONS_SERVICE)
    private readonly notifications: NotificationsService,
  ) {}

  quote(
    policySnapshot: Pick<PolicySnapshot, 'tiers'>,
    days: number,
    totalMinor: MinorUnits,
  ): RefundQuote {
    let tier: RefundQuote['tier'] = null;
    for (const t of policySnapshot.tiers) {
      if (t.daysBefore <= days && (!tier || t.daysBefore > tier.daysBefore)) {
        tier = t;
      }
    }
    const refundPercent = tier ? tier.refundPercent : 0;
    return {
      tier,
      refundPercent,
      amountMinor: percentOfMinor(totalMinor, refundPercent),
    };
  }

  async refundFor(
    type: BookingType,
    bookingId: string,
    reason: RefundReason,
  ): Promise<RefundRecord | null> {
    const view = await this.bookings.getPayable(type, bookingId);
    // Prefer the payment that confirmed the booking; other SUCCEEDED
    // payments of the booking are late/superseded and refunded separately.
    const payment = await this.payments.findOne(
      view.paymentId
        ? { _id: view.paymentId, status: PaymentStatus.SUCCEEDED }
        : { bookingType: type, bookingId, status: PaymentStatus.SUCCEEDED },
    );
    if (!payment) return null;

    const existing = await this.activeRefundFor(payment.stripeId);
    if (existing) return toRecord(existing);

    const pi = await this.stripe.paymentIntents.retrieve(payment.stripeId);
    const captured = pi.amount_received;
    let amountMinor: MinorUnits;
    if (reason === 'PROVIDER') {
      amountMinor = captured;
    } else {
      const days = daysRemaining(view.serviceStartsAt, view.timeZone);
      amountMinor = this.quote(
        { tiers: view.policySnapshot?.tiers ?? [] },
        days,
        captured,
      ).amountMinor;
    }
    if (!(amountMinor > 0)) return null;

    const doc = await this.issue(
      payment,
      payment.stripeId,
      amountMinor,
      reason,
      `refund-pi-${payment.stripeId}-${reason}`,
      view.userId,
    );
    await this.notifyIssued(doc, view.userId);
    return toRecord(doc);
  }

  /**
   * Full refund of the amount captured on one PaymentIntent of a payment,
   * independent of the booking (late or superseded payments). Idempotent
   * per PI id: a redelivered webhook returns the existing refund.
   */
  async refundPayment(
    payment: PaymentDocument,
    intent: Pick<Stripe.PaymentIntent, 'id' | 'amount_received'>,
    reason: RefundReason,
  ): Promise<RefundRecord | null> {
    const existing = await this.activeRefundFor(intent.id);
    if (existing) return toRecord(existing);
    const amountMinor = intent.amount_received;
    if (!(amountMinor > 0)) return null;
    const doc = await this.issue(
      payment,
      intent.id,
      amountMinor,
      reason,
      `refund-pi-${intent.id}`,
      payment.userId,
    );
    await this.notifyIssued(doc, payment.userId);
    return toRecord(doc);
  }

  private async notifyIssued(doc: RefundDocument, userId: string) {
    await this.notifications.notify(userId, {
      type: 'REFUND_ISSUED',
      title: 'Refund initiated',
      body: `A refund of ${minorToDecimalString(doc.amountMinor, doc.currency)} ${doc.currency} was initiated.`,
      link: `/refunds/${String(doc.id ?? doc._id)}`,
    });
  }

  private activeRefundFor(paymentIntentId: string) {
    return this.refunds.findOne({
      paymentIntentId,
      status: { $ne: RefundStatus.FAILED },
    });
  }

  /** Creates the Stripe refund and upserts its local record (by refund id). */
  private async issue(
    payment: PaymentDocument,
    paymentIntentId: string,
    amountMinor: MinorUnits,
    reason: RefundReason,
    idempotencyKey: string,
    userId: string,
  ): Promise<RefundDocument> {
    const sr = await this.stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: amountMinor,
        metadata: {
          bookingType: payment.bookingType,
          bookingId: payment.bookingId,
          paymentIntentId,
          reason,
        },
      },
      { idempotencyKey },
    );
    const fields = {
      bookingType: payment.bookingType,
      bookingId: payment.bookingId,
      userId,
      paymentId: String(payment.id ?? payment._id),
      paymentIntentId,
      stripeRefundId: sr.id,
      amountMinor,
      currency: payment.currency,
      reason,
      status: RefundStatus.PENDING,
    };
    const doc = await this.refunds.findOneAndUpdate(
      { stripeRefundId: sr.id },
      { $setOnInsert: fields },
      { upsert: true, new: true },
    );
    // upsert + new always yields a document; guard anyway.
    if (!doc) throw new Error(`Refund ${sr.id} was not recorded`);
    return doc;
  }

  /** Webhook: refund.updated / charge.refund.updated. */
  async applyStripeRefund(refund: Stripe.Refund): Promise<void> {
    let status: RefundStatus | null = null;
    if (refund.status === 'succeeded') status = RefundStatus.REFUNDED;
    else if (refund.status === 'failed' || refund.status === 'canceled')
      status = RefundStatus.FAILED;
    if (!status) return;
    // Only the first delivery that changes the status notifies the user.
    const doc = await this.refunds.findOneAndUpdate(
      { stripeRefundId: refund.id, status: { $ne: status } },
      { status },
      { new: true },
    );
    if (!doc) return;
    const amount = `${minorToDecimalString(doc.amountMinor, doc.currency)} ${doc.currency}`;
    const link = `/refunds/${String(doc.id ?? doc._id)}`;
    if (status === RefundStatus.REFUNDED) {
      await this.notifications.notify(doc.userId, {
        type: 'REFUND_COMPLETED',
        title: 'Refund completed',
        body: `Your refund of ${amount} has been completed.`,
        link,
      });
    } else {
      await this.notifications.notify(doc.userId, {
        type: 'REFUND_FAILED',
        title: 'Refund failed',
        body: `Your refund of ${amount} could not be completed. Please contact support.`,
        link,
      });
    }
  }

  async findById(id: string): Promise<RefundRecord | null> {
    const doc = await this.refunds.findById(id);
    return doc ? toRecord(doc) : null;
  }
}

function toRecord(d: RefundDocument): RefundRecord {
  const o = d as unknown as RefundRecord & { _id?: unknown };
  return {
    id: String(d.id ?? o._id),
    bookingType: d.bookingType,
    bookingId: d.bookingId,
    userId: d.userId,
    paymentId: d.paymentId,
    stripeRefundId: d.stripeRefundId,
    amountMinor: d.amountMinor,
    currency: d.currency,
    reason: d.reason,
    status: d.status,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

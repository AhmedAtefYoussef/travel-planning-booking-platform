import { randomBytes } from 'node:crypto';
import type {
  IntentStatus,
  PaymentIntentInfo,
  RefundInfo,
  StripeGateway,
} from '../../src/modules/payments/stripe-gateway';
import { StripeApiError } from '../../src/modules/payments/stripe-gateway';

/**
 * In-memory Stripe for e2e tests (ADR-0003): PaymentIntents and refunds with Stripe's idempotency and
 * state rules, and a call log so tests can assert what reached "Stripe". No network.
 */
export class FakeStripe implements StripeGateway {
  readonly intents = new Map<
    string,
    PaymentIntentInfo & { metadata: Record<string, string> }
  >();
  readonly refunds: (RefundInfo & {
    paymentIntentId: string;
    amountMinor?: number;
  })[] = [];
  readonly calls: string[] = [];
  private readonly byKey = new Map<string, string>();
  /** Set to make the next call throw, e.g. a Stripe outage. */
  failNext: Error | null = null;

  private check(call: string): void {
    this.calls.push(call);
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
  }

  createPaymentIntent(input: {
    amountMinor: number;
    currency: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<PaymentIntentInfo> {
    this.check('create');
    const existing = this.byKey.get(input.idempotencyKey);
    if (existing) return Promise.resolve(this.view(existing));
    const id = `pi_${randomBytes(12).toString('hex')}`;
    this.intents.set(id, {
      id,
      clientSecret: `${id}_secret_${randomBytes(8).toString('hex')}`,
      status: 'requires_payment_method',
      amountMinor: input.amountMinor,
      currency: input.currency,
      metadata: input.metadata,
    });
    this.byKey.set(input.idempotencyKey, id);
    return Promise.resolve(this.view(id));
  }

  retrievePaymentIntent(id: string): Promise<PaymentIntentInfo> {
    this.check('retrieve');
    return Promise.resolve(this.view(id));
  }

  cancelPaymentIntent(id: string): Promise<PaymentIntentInfo> {
    this.check('cancel');
    const pi = this.get(id);
    if (pi.status === 'succeeded' || pi.status === 'canceled') {
      return Promise.reject(
        new StripeApiError(
          `You cannot cancel this PaymentIntent because it has a status of ${pi.status}.`,
          400,
          'payment_intent_unexpected_state',
        ),
      );
    }
    pi.status = 'canceled';
    return Promise.resolve(this.view(id));
  }

  createRefund(input: {
    paymentIntentId: string;
    amountMinor?: number;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<RefundInfo> {
    this.check('refund');
    const existing = this.refunds.find(
      (r) => r.id === this.byKey.get(input.idempotencyKey),
    );
    if (existing)
      return Promise.resolve({ id: existing.id, status: existing.status });
    const refund = {
      id: `re_${randomBytes(12).toString('hex')}`,
      status: 'pending',
      paymentIntentId: input.paymentIntentId,
      amountMinor: input.amountMinor,
    };
    this.refunds.push(refund);
    this.byKey.set(input.idempotencyKey, refund.id);
    return Promise.resolve({ id: refund.id, status: refund.status });
  }

  /** What a customer paying in Stripe Elements would cause. */
  setStatus(id: string, status: IntentStatus): void {
    this.get(id).status = status;
  }

  private get(id: string) {
    const pi = this.intents.get(id);
    if (!pi)
      throw new StripeApiError(
        `No such payment_intent: '${id}'`,
        404,
        'resource_missing',
      );
    return pi;
  }

  private view(id: string): PaymentIntentInfo {
    const {
      id: piId,
      clientSecret,
      status,
      amountMinor,
      currency,
    } = this.get(id);
    return { id: piId, clientSecret, status, amountMinor, currency };
  }
}

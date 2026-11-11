import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { EnvironmentVariables } from '../../config/env.validation';

/**
 * Stripe refused or could not be reached (network, invalid key, rate limit). The message is Stripe's
 * error type only, never the request or the key.
 */
export class PaymentProviderError extends Error {
  /**
   * False when Stripe rejected the request itself (invalid request, e.g. a charge already refunded):
   * sending the same request again can never succeed.
   */
  readonly retryable: boolean;

  constructor(message: string, retryable = true) {
    super(message);
    this.name = 'PaymentProviderError';
    this.retryable = retryable;
  }
}

/** Runs a Stripe call and turns any SDK error into a PaymentProviderError. */
async function call<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const type = (e as { type?: unknown }).type;
    const code = (e as { code?: unknown }).code;
    throw new PaymentProviderError(
      `Stripe ${operation} failed${typeof type === 'string' ? ` (${type}${typeof code === 'string' ? `: ${code}` : ''})` : ''}`,
      type !== 'StripeInvalidRequestError',
    );
  }
}

/** Injection token of the Stripe boundary; tests replace it with a fake (no network). */
export const STRIPE_GATEWAY = Symbol('STRIPE_GATEWAY');

/** What the backend keeps from a PaymentIntent. The client secret is returned, never stored. */
export interface GatewayIntent {
  id: string;
  clientSecret: string | null;
  status: string;
}

/** What the backend keeps from a Stripe refund. */
export interface GatewayRefund {
  id: string;
  status: string;
  failureReason?: string | null;
}

/** The fields of a verified webhook event this module uses. */
export interface GatewayEvent {
  id: string;
  type: string;
  object: {
    id: string;
    status?: string;
    /** payment_intent.succeeded: what Stripe actually collected, minor units. */
    amountReceived?: number | null;
    /** Upper-case ISO code. */
    currency?: string | null;
    lastPaymentErrorMessage?: string | null;
    paymentIntentId?: string | null;
    failureReason?: string | null;
    /** Refund events: our refund record id, from the metadata we sent with the refund request. */
    refundRecordId?: string | null;
  };
}

/**
 * Everything the payments module needs from Stripe (brief section 6.4, ADR-0003), behind one small
 * interface: card details are entered in Stripe Elements on the frontend and never reach this
 * backend; only ids, amounts, currencies and statuses cross this boundary.
 */
export interface StripeGateway {
  createPaymentIntent(input: {
    amountMinor: number;
    currency: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<GatewayIntent>;
  retrievePaymentIntent(id: string): Promise<GatewayIntent>;
  /** Resolves when the intent is canceled or was already canceled. */
  cancelPaymentIntent(id: string): Promise<GatewayIntent>;
  createRefund(input: {
    paymentIntentId: string;
    amountMinor: number;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<GatewayRefund>;
  /** Verifies the Stripe-Signature header against the raw body; throws when it does not match. */
  constructEvent(rawBody: Buffer, signature: string): GatewayEvent;
}

/** The real gateway: the official SDK with the TEST-mode secret key (env validation rejects live keys). */
@Injectable()
export class StripeSdkGateway implements StripeGateway {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.stripe = new Stripe(config.get('STRIPE_SECRET_KEY', { infer: true }), {
      maxNetworkRetries: 2,
      timeout: 15_000,
    });
    this.webhookSecret = config.get('STRIPE_WEBHOOK_SECRET', { infer: true });
  }

  async createPaymentIntent(input: {
    amountMinor: number;
    currency: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<GatewayIntent> {
    const intent = await call('create payment intent', () =>
      this.stripe.paymentIntents.create(
        {
          amount: input.amountMinor,
          currency: input.currency.toLowerCase(),
          metadata: input.metadata,
          // Immediate methods only (cards in Stripe Elements): no redirect or delayed methods that
          // could still be "processing" after the 10-minute hold.
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: 'never',
          },
        },
        { idempotencyKey: input.idempotencyKey },
      ),
    );
    return toIntent(intent);
  }

  async retrievePaymentIntent(id: string): Promise<GatewayIntent> {
    return toIntent(
      await call('retrieve payment intent', () =>
        this.stripe.paymentIntents.retrieve(id),
      ),
    );
  }

  async cancelPaymentIntent(id: string): Promise<GatewayIntent> {
    const current = await call('retrieve payment intent', () =>
      this.stripe.paymentIntents.retrieve(id),
    );
    if (current.status === 'canceled' || current.status === 'succeeded') {
      return toIntent(current);
    }
    return toIntent(
      await call('cancel payment intent', () =>
        this.stripe.paymentIntents.cancel(id),
      ),
    );
  }

  async createRefund(input: {
    paymentIntentId: string;
    amountMinor: number;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<GatewayRefund> {
    const refund = await call('create refund', () =>
      this.stripe.refunds.create(
        {
          payment_intent: input.paymentIntentId,
          amount: input.amountMinor,
          metadata: input.metadata,
        },
        { idempotencyKey: input.idempotencyKey },
      ),
    );
    return {
      id: refund.id,
      status: refund.status ?? 'pending',
      failureReason: refund.failure_reason ?? null,
    };
  }

  constructEvent(rawBody: Buffer, signature: string): GatewayEvent {
    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );
    return toGatewayEvent(event);
  }
}

function toIntent(intent: {
  id: string;
  client_secret: string | null;
  status: string;
}): GatewayIntent {
  return {
    id: intent.id,
    clientSecret: intent.client_secret,
    status: intent.status,
  };
}

/** Narrows a verified Stripe event to the fields used here (payment intents and refunds). */
export function toGatewayEvent(event: {
  id: string;
  type: string;
  data: { object: unknown };
}): GatewayEvent {
  const object = (event.data?.object ?? {}) as Record<string, unknown>;
  const lastError = object.last_payment_error as
    { message?: string } | null | undefined;
  const paymentIntent = object.payment_intent;
  const metadata = (object.metadata ?? {}) as Record<string, unknown>;
  return {
    id: event.id,
    type: event.type,
    object: {
      id: typeof object.id === 'string' ? object.id : '',
      status: typeof object.status === 'string' ? object.status : undefined,
      amountReceived:
        typeof object.amount_received === 'number'
          ? object.amount_received
          : null,
      currency:
        typeof object.currency === 'string'
          ? object.currency.toUpperCase()
          : null,
      lastPaymentErrorMessage: lastError?.message ?? null,
      paymentIntentId:
        typeof paymentIntent === 'string'
          ? paymentIntent
          : typeof (paymentIntent as { id?: unknown } | null)?.id === 'string'
            ? (paymentIntent as { id: string }).id
            : null,
      failureReason:
        typeof object.failure_reason === 'string'
          ? object.failure_reason
          : null,
      refundRecordId:
        typeof metadata.refundId === 'string' ? metadata.refundId : null,
    },
  };
}

/**
 * The only door to Stripe (ADR-0003). The real adapter (HttpStripeGateway) calls Stripe's REST API in
 * test mode; e2e tests replace it with an in-memory fake, so CI never touches the network.
 */
export const STRIPE_GATEWAY = Symbol('STRIPE_GATEWAY');

/** Stripe PaymentIntent statuses (https://docs.stripe.com/payments/paymentintents/lifecycle). */
export type IntentStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_action'
  | 'processing'
  | 'requires_capture'
  | 'canceled'
  | 'succeeded';

export interface PaymentIntentInfo {
  id: string;
  /** Handed to Stripe Elements on the frontend; card details go from the browser straight to Stripe. */
  clientSecret: string;
  status: IntentStatus;
  amountMinor: number;
  /** Upper-case ISO 4217. */
  currency: string;
}

export interface RefundInfo {
  id: string;
  status: string;
}

export interface StripeGateway {
  /** Same `idempotencyKey` = same PaymentIntent, so a repeated request never charges twice. */
  createPaymentIntent(input: {
    amountMinor: number;
    currency: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<PaymentIntentInfo>;
  retrievePaymentIntent(id: string): Promise<PaymentIntentInfo>;
  cancelPaymentIntent(id: string): Promise<PaymentIntentInfo>;
  /** Full refund when `amountMinor` is omitted. */
  createRefund(input: {
    paymentIntentId: string;
    amountMinor?: number;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<RefundInfo>;
}

/** A Stripe API error with its HTTP status and Stripe error code (e.g. payment_intent_unexpected_state). */
export class StripeApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'StripeApiError';
  }
}

/** The part of a Stripe webhook event the webhook handler reads. */
export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: {
      id?: string;
      object?: string;
      status?: string;
      last_payment_error?: { message?: string } | null;
      metadata?: Record<string, string>;
    };
  };
}

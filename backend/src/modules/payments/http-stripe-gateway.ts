import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import {
  StripeApiError,
  type IntentStatus,
  type PaymentIntentInfo,
  type RefundInfo,
  type StripeGateway,
} from './stripe-gateway';

const API = 'https://api.stripe.com/v1';
const TIMEOUT_MS = 15_000;

interface StripeIntentBody {
  id: string;
  client_secret: string;
  status: IntentStatus;
  amount: number;
  currency: string;
}

/**
 * STRIPE_GATEWAY over Stripe's REST API with Node's fetch (no SDK dependency). The key is a test-mode
 * key (env validation refuses anything but sk_test_), and only ids, amount, currency and status are
 * read back; card data never passes through this server (Stripe Elements on the frontend).
 */
@Injectable()
export class HttpStripeGateway implements StripeGateway {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async createPaymentIntent(input: {
    amountMinor: number;
    currency: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<PaymentIntentInfo> {
    const form: Record<string, string> = {
      amount: String(input.amountMinor),
      currency: input.currency.toLowerCase(),
      'automatic_payment_methods[enabled]': 'true',
    };
    for (const [k, v] of Object.entries(input.metadata)) {
      form[`metadata[${k}]`] = v;
    }
    return toIntent(
      await this.call<StripeIntentBody>(
        'POST',
        '/payment_intents',
        form,
        input.idempotencyKey,
      ),
    );
  }

  async retrievePaymentIntent(id: string): Promise<PaymentIntentInfo> {
    return toIntent(
      await this.call<StripeIntentBody>(
        'GET',
        `/payment_intents/${encodeURIComponent(id)}`,
      ),
    );
  }

  async cancelPaymentIntent(id: string): Promise<PaymentIntentInfo> {
    return toIntent(
      await this.call<StripeIntentBody>(
        'POST',
        `/payment_intents/${encodeURIComponent(id)}/cancel`,
        {},
        `cancel:${id}`,
      ),
    );
  }

  async createRefund(input: {
    paymentIntentId: string;
    amountMinor?: number;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<RefundInfo> {
    const form: Record<string, string> = {
      payment_intent: input.paymentIntentId,
    };
    if (input.amountMinor !== undefined)
      form.amount = String(input.amountMinor);
    for (const [k, v] of Object.entries(input.metadata)) {
      form[`metadata[${k}]`] = v;
    }
    const body = await this.call<{ id: string; status: string }>(
      'POST',
      '/refunds',
      form,
      input.idempotencyKey,
    );
    return { id: body.id, status: body.status };
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    form?: Record<string, string>,
    idempotencyKey?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.get('STRIPE_SECRET_KEY', { infer: true })}`,
    };
    if (method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    }
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers,
        body:
          method === 'POST'
            ? new URLSearchParams(form ?? {}).toString()
            : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new StripeApiError(
        `Stripe could not be reached: ${e instanceof Error ? e.message : String(e)}`,
        503,
        'network_error',
      );
    }
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; code?: string };
    } & T;
    if (!res.ok) {
      throw new StripeApiError(
        body.error?.message ?? `Stripe answered ${res.status}`,
        res.status,
        body.error?.code ?? null,
      );
    }
    return body;
  }
}

function toIntent(b: StripeIntentBody): PaymentIntentInfo {
  return {
    id: b.id,
    clientSecret: b.client_secret,
    status: b.status,
    amountMinor: b.amount,
    currency: b.currency.toUpperCase(),
  };
}

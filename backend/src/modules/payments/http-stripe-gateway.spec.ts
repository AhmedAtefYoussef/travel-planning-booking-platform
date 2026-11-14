import { HttpStripeGateway } from './http-stripe-gateway';
import { StripeApiError } from './stripe-gateway';

const KEY = 'sk_test_placeholder';
const config = { get: jest.fn().mockReturnValue(KEY) };

function respond(status: number, body: unknown) {
  return jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

const intent = {
  id: 'pi_1',
  client_secret: 'pi_1_secret_x',
  status: 'requires_payment_method',
  amount: 12000,
  currency: 'usd',
};

describe('HttpStripeGateway (PAY-01, Stripe REST in test mode)', () => {
  afterEach(() => jest.restoreAllMocks());
  const gateway = new HttpStripeGateway(config as never);

  it('creates a PaymentIntent with form fields, the test key and the idempotency key', async () => {
    const fetch = respond(200, intent);
    const pi = await gateway.createPaymentIntent({
      amountMinor: 12000,
      currency: 'USD',
      metadata: { bookingId: 'b1' },
      idempotencyKey: 'checkout:FLIGHT:b1',
    });
    expect(pi).toEqual({
      id: 'pi_1',
      clientSecret: 'pi_1_secret_x',
      status: 'requires_payment_method',
      amountMinor: 12000,
      currency: 'USD',
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/payment_intents');
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers['Idempotency-Key']).toBe('checkout:FLIGHT:b1');
    const form = new URLSearchParams(init!.body as string);
    expect(form.get('amount')).toBe('12000');
    expect(form.get('currency')).toBe('usd');
    expect(form.get('automatic_payment_methods[enabled]')).toBe('true');
    expect(form.get('metadata[bookingId]')).toBe('b1');
  });

  it('retrieves with GET and no body', async () => {
    const fetch = respond(200, { ...intent, status: 'succeeded' });
    await expect(gateway.retrievePaymentIntent('pi_1')).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      body: undefined,
    });
  });

  it('cancels and refunds (full when no amount is given)', async () => {
    const fetch = respond(200, { ...intent, status: 'canceled' });
    await gateway.cancelPaymentIntent('pi_1');
    expect(fetch.mock.calls[0][0]).toBe(
      'https://api.stripe.com/v1/payment_intents/pi_1/cancel',
    );
    jest.restoreAllMocks();
    const refund = respond(200, { id: 're_1', status: 'pending' });
    await expect(
      gateway.createRefund({
        paymentIntentId: 'pi_1',
        metadata: {},
        idempotencyKey: 'k',
      }),
    ).resolves.toEqual({ id: 're_1', status: 'pending' });
    const form = new URLSearchParams(refund.mock.calls[0][1]!.body as string);
    expect(form.get('payment_intent')).toBe('pi_1');
    expect(form.has('amount')).toBe(false);
  });

  it("maps Stripe's error body to StripeApiError with status and code", async () => {
    respond(400, {
      error: {
        message: 'Cannot cancel',
        code: 'payment_intent_unexpected_state',
      },
    });
    await expect(gateway.cancelPaymentIntent('pi_1')).rejects.toMatchObject({
      name: 'StripeApiError',
      httpStatus: 400,
      code: 'payment_intent_unexpected_state',
      message: 'Cannot cancel',
    });
  });

  it('reports a network failure as a 503 StripeApiError', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    const err = await gateway
      .retrievePaymentIntent('pi_1')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StripeApiError);
    expect(err).toMatchObject({ httpStatus: 503, code: 'network_error' });
  });
});

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import request from 'supertest';
import { BookingType } from '../src/common/contracts/booking.contract';
import {
  PAYABLE_BOOKING,
  POLICIES_PROVIDER,
  REFUNDS_SERVICE,
} from '../src/common/contracts/tokens';
import type { RefundsService } from '../src/common/contracts/refunds.contract';
import type { PayableBookingStub } from '../src/common/stubs/payable-booking.stub';
import type { PoliciesStub } from '../src/common/stubs/policies.stub';
import {
  asUser,
  createTestApp,
  seedBooking,
  signedEvent,
  TestApp,
} from './utils/test-app';

jest.setTimeout(120_000);

/** PAY-04: PLATFORM_CURRENCY (not a hardcoded USD) drives every amount. */
describe('PLATFORM_CURRENCY=EUR (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ platformCurrency: 'EUR' });
  });
  afterAll(async () => {
    await t.close();
  });

  it('uses EUR on the PaymentIntent, the payment and the refund', async () => {
    const http = () => request(t.app.getHttpServer());
    const bookings: PayableBookingStub = t.app.get(PAYABLE_BOOKING);
    const policies: PoliciesStub = t.app.get(POLICIES_PROVIDER);
    const refunds: RefundsService = t.app.get(REFUNDS_SERVICE);

    policies.set({
      kind: 'AIRLINE',
      providerId: 'airline-eur',
      tiers: [{ daysBefore: 7, refundPercent: 100 }],
      extraBaggage: null,
      cabins: [{ cabin: 'ECONOMY', freeBaggageKg: 20 }],
    });
    const b = seedBooking(bookings, BookingType.FLIGHT, {
      providerId: 'airline-eur',
      totalMinor: 12000,
    });
    await http()
      .post(`/api/bookings/${b.urlType}/${b.id}/accept-policies`)
      .set(asUser())
      .send({ accepted: true })
      .expect(200);

    const created = await http()
      .post('/api/payments')
      .set(asUser())
      .send({ bookingType: b.type, bookingId: b.id })
      .expect(201);
    expect(created.body.currency).toBe('EUR');
    const intentArgs = t.stripe.paymentIntents.create.mock.calls.at(-1)![0];
    expect(intentArgs.currency).toBe('eur');

    const payment = await http()
      .get(`/api/payments/${created.body.paymentId}`)
      .set(asUser())
      .expect(200);
    expect(payment.body.currency).toBe('EUR');

    const piId = [...t.stripe.intents.keys()].at(-1)!;
    const intent = t.stripe.intents.get(piId)!;
    intent.status = 'succeeded';
    intent.amount_received = intent.amount;
    const evt = signedEvent('payment_intent.succeeded', {
      id: piId,
      object: 'payment_intent',
      status: 'succeeded',
    });
    await http()
      .post('/api/payments/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', evt.signature)
      .send(evt.payload)
      .expect(200);

    const refund = await refunds.refundFor(b.type, b.id, 'USER');
    expect(refund).not.toBeNull();
    expect(refund!.currency).toBe('EUR');
    const got = await http()
      .get(`/api/refunds/${refund!.id}`)
      .set(asUser())
      .expect(200);
    expect(got.body.currency).toBe('EUR');
  });
});

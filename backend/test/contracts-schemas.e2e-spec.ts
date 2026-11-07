import { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import {
  AUDIT_SERVICE,
  AuditAction,
  AuditService,
  AuditTargetType,
  BookingType,
  RefundReason,
} from '../src/common/contracts';
import { AuditLog } from '../src/modules/audit/schemas/audit-log.schema';
import {
  Payment,
  PaymentStatus,
} from '../src/modules/payments/schemas/payment.schema';
import { Refund } from '../src/modules/payments/schemas/refund.schema';
import { StripeEvent } from '../src/modules/payments/schemas/stripe-event.schema';
import { createTestApp } from './support/create-test-app';

const oid = () => new Types.ObjectId();

describe('Contracts and schemas (e2e): TRVL-132, TRVL-161, TRVL-162', () => {
  let app: INestApplication<App>;
  let connection: Connection;
  let audit: AuditService;
  let auditLogs: Model<AuditLog>;
  let payments: Model<Payment>;
  let refunds: Model<Refund>;
  let events: Model<StripeEvent>;

  beforeAll(async () => {
    app = await createTestApp();
    connection = app.get<Connection>(getConnectionToken());
    audit = app.get<AuditService>(AUDIT_SERVICE);
    auditLogs = app.get(getModelToken(AuditLog.name));
    payments = app.get(getModelToken(Payment.name));
    refunds = app.get(getModelToken(Refund.name));
    events = app.get(getModelToken(StripeEvent.name));
    await Promise.all(
      [auditLogs, payments, refunds, events].map((m) => m.syncIndexes()),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('AUDIT_SERVICE (GEN-07)', () => {
    const entry = () => ({
      actor: { id: oid().toHexString(), role: Role.Admin },
      action: AuditAction.SuspendAccount,
      targetType: AuditTargetType.User,
      targetId: oid().toHexString(),
      reason: 'Spam',
      metadata: {
        before: 'ACTIVE',
        after: 'SUSPENDED',
        password: 'x',
        nested: { token: 'y', ok: 1 },
      },
    });

    it('records entries and strips secret-looking metadata', async () => {
      const e = entry();
      await audit.record(e);

      const saved = await auditLogs.findOne({ targetId: e.targetId }).lean();
      expect(saved).toMatchObject({
        action: 'SUSPEND_ACCOUNT',
        actorRole: 'ADMIN',
        reason: 'Spam',
      });
      expect(saved?.metadata).toEqual({
        before: 'ACTIVE',
        after: 'SUSPENDED',
        nested: { ok: 1 },
      });
      expect(saved?.createdAt).toBeInstanceOf(Date);
    });

    it('is append-only at the model level', async () => {
      await expect(
        auditLogs.updateMany({}, { reason: 'edited' }),
      ).rejects.toThrow(/append-only/);
      await expect(auditLogs.deleteMany({})).rejects.toThrow(/append-only/);
    });

    it('commits or aborts with the admin action transaction', async () => {
      const e = entry();
      const session = await connection.startSession();
      await expect(
        session.withTransaction(async () => {
          await audit.record(e, session);
          throw new Error('admin action failed');
        }),
      ).rejects.toThrow('admin action failed');
      await session.endSession();
      expect(await auditLogs.countDocuments({ targetId: e.targetId })).toBe(0);
    });
  });

  describe('payments (PAY-01, PAY-04)', () => {
    const payment = (overrides: Partial<Payment> = {}) => ({
      bookingType: BookingType.Flight,
      bookingId: oid(),
      userId: oid(),
      stripePaymentIntentId: `pi_${oid().toHexString()}`,
      amountMinor: 12_500,
      currency: 'USD',
      ...overrides,
    });

    it('rejects non-integer amounts and malformed Stripe ids', async () => {
      await expect(
        payments.create(payment({ amountMinor: 12.5 })),
      ).rejects.toThrow(/integer/);
      await expect(
        payments.create(payment({ stripePaymentIntentId: 'abc' })),
      ).rejects.toThrow();
    });

    it('keeps PaymentIntent ids unique', async () => {
      const p = payment();
      await payments.create(p);
      await expect(
        payments.create({ ...p, bookingId: oid() }),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('allows retries but at most one successful payment per booking', async () => {
      const bookingId = oid();
      await payments.create(
        payment({ bookingId, status: PaymentStatus.Failed }),
      );
      await payments.create(
        payment({ bookingId, status: PaymentStatus.Succeeded }),
      );
      await expect(
        payments.create(
          payment({ bookingId, status: PaymentStatus.Succeeded }),
        ),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('stores no card data fields', () => {
      const paths = Object.keys(payments.schema.paths).join(',');
      expect(paths).not.toMatch(/card|cvc|cvv|exp/i);
    });
  });

  describe('refunds (PAY-03)', () => {
    const refund = (bookingId = oid()) => ({
      paymentId: oid(),
      bookingType: BookingType.Hotel,
      bookingId,
      userId: oid(),
      amountMinor: 5_000,
      currency: 'USD',
      refundPercent: 50,
      tierApplied: { daysBefore: 7, percent: 50 },
      reason: RefundReason.UserCancellation,
    });

    it('defaults to PENDING and refunds a booking at most once', async () => {
      const bookingId = oid();
      const doc = await refunds.create(refund(bookingId));
      expect(doc.status).toBe('PENDING');
      await expect(refunds.create(refund(bookingId))).rejects.toMatchObject({
        code: 11000,
      });
    });

    it('allows many refunds without a Stripe id yet, but Stripe ids are unique', async () => {
      await refunds.create(refund());
      await refunds.create(refund());
      await refunds.create({ ...refund(), stripeRefundId: 're_123' });
      await expect(
        refunds.create({ ...refund(), stripeRefundId: 're_123' }),
      ).rejects.toMatchObject({
        code: 11000,
      });
    });
  });

  describe('stripe_events (webhook idempotency)', () => {
    it('rejects a replayed event id', async () => {
      await events.create({
        stripeEventId: 'evt_1',
        type: 'payment_intent.succeeded',
      });
      await expect(
        events.create({
          stripeEventId: 'evt_1',
          type: 'payment_intent.succeeded',
        }),
      ).rejects.toMatchObject({ code: 11000 });
    });
  });
});

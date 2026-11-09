/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Stripe from 'stripe';
import {
  BookingStatus,
  BookingType,
  PayableBookingView,
} from '../../src/common/contracts/booking.contract';
import { PayableBookingStub } from '../../src/common/stubs/payable-booking.stub';

export const WEBHOOK_SECRET = 'whsec_' + 'e2e'.repeat(12);
export const USER_ID = 'a'.repeat(24);
export const OTHER_USER_ID = 'b'.repeat(24);
export const ADMIN_ID = 'c'.repeat(24);

export function asUser(id: string = USER_ID, role = 'USER') {
  return { 'x-dev-user-id': id, 'x-dev-role': role };
}
export const asAdmin = () => asUser(ADMIN_ID, 'ADMIN');

export function newObjectId(): string {
  return randomBytes(12).toString('hex');
}

/* ---------------- Stripe fake (jest fns) + real webhook utility ---------------- */

export interface FakeIntent {
  id: string;
  object: 'payment_intent';
  amount: number;
  currency: string;
  status: string;
  amount_received: number;
  client_secret: string;
  metadata: Record<string, string>;
}

export function createFakeStripe() {
  const real = new Stripe('sk_test_e2e_placeholder');
  const intents = new Map<string, FakeIntent>();
  let seq = 0;
  return {
    intents,
    /** Real signature verification and signing helpers. */
    webhooks: real.webhooks,
    paymentIntents: {
      create: jest.fn((params: Record<string, any>) => {
        seq += 1;
        const pi: FakeIntent = {
          id: `pi_e2e_${seq}`,
          object: 'payment_intent',
          amount: params.amount,
          currency: params.currency,
          status: 'requires_payment_method',
          amount_received: 0,
          client_secret: `pi_e2e_${seq}_secret_x${seq}`,
          metadata: params.metadata ?? {},
        };
        intents.set(pi.id, pi);
        return Promise.resolve({ ...pi });
      }),
      retrieve: jest.fn((id: string) => {
        const pi = intents.get(id);
        return pi
          ? Promise.resolve({ ...pi })
          : Promise.reject(new Error('No such payment_intent'));
      }),
      update: jest.fn((id: string, params: Record<string, any>) => {
        const pi = intents.get(id)!;
        Object.assign(pi, params);
        return Promise.resolve({ ...pi });
      }),
      confirm: jest.fn((id: string) => {
        const pi = intents.get(id)!;
        pi.status = 'succeeded';
        pi.amount_received = pi.amount;
        return Promise.resolve({ ...pi });
      }),
      cancel: jest.fn((id: string) => {
        const pi = intents.get(id)!;
        pi.status = 'canceled';
        return Promise.resolve({ ...pi });
      }),
    },
    refunds: {
      create: jest.fn((params: Record<string, any>) => {
        seq += 1;
        return Promise.resolve({
          id: `re_e2e_${seq}`,
          object: 'refund',
          amount: params.amount,
          currency: params.currency ?? 'usd',
          payment_intent: params.payment_intent,
          status: 'pending',
        });
      }),
    },
  };
}
export type FakeStripe = ReturnType<typeof createFakeStripe>;

/** Builds a validly signed Stripe webhook request (pass `secret` to forge). */
export function signedEvent(
  type: string,
  object: Record<string, unknown>,
  opts: { secret?: string; id?: string } = {},
) {
  const payload = JSON.stringify({
    id: opts.id ?? `evt_${randomBytes(6).toString('hex')}`,
    object: 'event',
    api_version: '2024-06-20',
    created: Math.floor(Date.now() / 1000),
    type,
    data: { object },
  });
  const signature = new Stripe(
    'sk_test_e2e_placeholder',
  ).webhooks.generateTestHeaderString({
    payload,
    secret: opts.secret ?? WEBHOOK_SECRET,
  });
  return { payload, signature };
}

/* ---------------- Fake FX API ---------------- */

export interface FakeFx {
  url: string;
  setFailing(failing: boolean): void;
  hits: () => number;
  close(): Promise<void>;
}
export const FX_RATES = {
  USD: 1,
  EGP: 48.5,
  AED: 3.6725,
  GBP: 0.79,
  EUR: 0.92,
  JPY: 150,
  SAR: 3.75,
};

export async function startFakeFx(initiallyFailing = false): Promise<FakeFx> {
  let failing = initiallyFailing;
  let hits = 0;
  const server: Server = createServer((req, res) => {
    hits += 1;
    if (failing || !req.url?.startsWith('/latest')) {
      res.statusCode = 500;
      res.end('{"success":false}');
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        success: true,
        base: 'USD',
        date: new Date().toISOString().slice(0, 10),
        timestamp: Math.floor(Date.now() / 1000),
        rates: FX_RATES,
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    setFailing: (f) => {
      failing = f;
    },
    hits: () => hits,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/* ---------------- Booking seeding ---------------- */

export function seedBooking(
  bookings: PayableBookingStub,
  type: BookingType,
  overrides: Partial<PayableBookingView> = {},
): { type: BookingType; id: string; urlType: 'flight' | 'hotel' } {
  const id = newObjectId();
  bookings.seed(type, id, {
    userId: USER_ID,
    totalMinor: 25000,
    status: BookingStatus.PENDING_PAYMENT,
    holdExpiresAt: new Date(Date.now() + 10 * 60_000),
    policiesAcceptedAt: null,
    providerId: type === BookingType.HOTEL ? 'hotel-e2e' : 'airline-e2e',
    serviceStartsAt: new Date(Date.now() + 30 * 86_400_000),
    timeZone: 'UTC',
    policySnapshot: null,
    paymentId: null,
    ...overrides,
  });
  return { type, id, urlType: type === BookingType.HOTEL ? 'hotel' : 'flight' };
}

/* ---------------- App factory ---------------- */

export interface TestApp {
  app: INestApplication;
  stripe: FakeStripe;
  mongo: MongoMemoryReplSet;
  fx: FakeFx;
  uploadDir: string;
  close(): Promise<void>;
}

export interface TestAppOptions {
  /** Start the fake FX API in failing mode (no rates ever available). */
  fxFailing?: boolean;
  /** PLATFORM_CURRENCY for this app (default USD). */
  platformCurrency?: string;
}

/**
 * Boots the real AppModule against an in-memory Mongo replica set. Env must
 * be set before AppModule is imported (ConfigModule validates at import), so
 * app code is loaded with require() (ts-jest rejects dynamic import()).
 */
export async function createTestApp(
  opts: TestAppOptions = {},
): Promise<TestApp> {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const fx = await startFakeFx(opts.fxFailing ?? false);
  const uploadDir = mkdtempSync(join(tmpdir(), 'travel-e2e-uploads-'));

  Object.assign(process.env, {
    NODE_ENV: 'test',
    MONGODB_URI: mongo.getUri('travel_e2e'),
    JWT_SECRET: 'e2e-only-placeholder-'.padEnd(40, 'x'),
    PLATFORM_CURRENCY: opts.platformCurrency ?? 'USD',
    STRIPE_SECRET_KEY: 'sk_test_e2e_placeholder',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    FX_API_BASE_URL: fx.url,
    FX_API_KEY: 'e2e-fx-key',
    UPLOAD_DIR: uploadDir,
  });

  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-member-access */
  const { AppModule } = require('../../src/app.module');
  const {
    STRIPE_CLIENT,
  } = require('../../src/modules/payments/stripe.provider');
  const { setupApp } = require('../../src/bootstrap/setup-app');
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-member-access */

  const stripe = createFakeStripe();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(STRIPE_CLIENT)
    .useValue(stripe)
    .compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  app.setGlobalPrefix('api');
  setupApp(app);
  await app.init();

  return {
    app,
    stripe,
    mongo,
    fx,
    uploadDir,
    close: async () => {
      await app.close();
      await fx.close();
      await mongo.stop();
    },
  };
}

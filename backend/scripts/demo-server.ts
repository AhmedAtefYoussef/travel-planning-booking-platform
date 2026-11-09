/**
 * Starts the API for the Swagger payment demo (docs/api/swagger-demo.md).
 *
 * Karim's booking modules are not bound to PAYABLE_BOOKING yet, so the
 * in-memory PayableBookingStub is used and two demo bookings (one flight,
 * one hotel) are seeded here. They are lost on restart.
 *
 *   npx ts-node scripts/demo-server.ts
 *
 * Reads backend/.env like `npm run start:dev` (needs DEV_AUTH_ENABLED=true,
 * NODE_ENV=development and your own Stripe test keys). Set
 * DEMO_IN_MEMORY_DB=true to use a throw-away in-memory MongoDB instead of
 * MONGODB_URI.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';

export const DEMO_USER_ID = 'a'.repeat(24);
export const DEMO_FLIGHT_ID = '1'.repeat(24);
export const DEMO_HOTEL_ID = '2'.repeat(24);

async function main(): Promise<void> {
  let mongo: MongoMemoryReplSet | undefined;
  if (process.env.DEMO_IN_MEMORY_DB === 'true') {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGODB_URI = mongo.getUri('travel_demo');
  }

  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
  // Required after the env is final: ConfigModule validates at import time.
  const { NestFactory } = require('@nestjs/core');
  const { ConfigService } = require('@nestjs/config');
  const { AppModule } = require('../src/app.module');
  const { setupApp } = require('../src/bootstrap/setup-app');
  const {
    BookingStatus,
    BookingType,
  } = require('../src/common/contracts/booking.contract');
  const {
    PayableBookingStub,
  } = require('../src/common/stubs/payable-booking.stub');

  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix('api');
  setupApp(app);

  const bookings = app.get(PayableBookingStub);
  const seed = (type: string, id: string, providerId: string) =>
    bookings.seed(type, id, {
      userId: DEMO_USER_ID,
      totalMinor: 25000,
      status: BookingStatus.PENDING_PAYMENT,
      holdExpiresAt: new Date(Date.now() + 60 * 60_000),
      policiesAcceptedAt: null,
      providerId,
      serviceStartsAt: new Date(Date.now() + 30 * 86_400_000),
      timeZone: 'UTC',
      policySnapshot: null,
      paymentId: null,
    });
  seed(BookingType.FLIGHT, DEMO_FLIGHT_ID, 'airline-demo');
  seed(BookingType.HOTEL, DEMO_HOTEL_ID, 'hotel-demo');

  const port = app.get(ConfigService).getOrThrow('PORT');
  await app.listen(port);
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */

  console.log(`Swagger UI:  http://localhost:${port}/api/docs`);
  console.log(`Headers:     x-dev-user-id: ${DEMO_USER_ID}   x-dev-role: USER`);
  console.log(
    `Flight (25000 USD cents, hold 60 min): type=flight id=${DEMO_FLIGHT_ID}`,
  );
  console.log(
    `Hotel  (25000 USD cents, hold 60 min): type=hotel  id=${DEMO_HOTEL_ID}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

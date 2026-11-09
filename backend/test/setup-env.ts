// Runs before any test module is imported: ConfigModule validates env at
// import time. Non-secret placeholders for the e2e suite only.
process.env.NODE_ENV = 'test';
process.env.DEV_AUTH_ENABLED = 'true';
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27017/travel-e2e';
process.env.JWT_SECRET ??= 'e2e-only-placeholder-'.padEnd(40, 'x');

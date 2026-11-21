import { MongoMemoryReplSet } from 'mongodb-memory-server';

declare global {
  var __MONGO_REPLSET__: MongoMemoryReplSet | undefined;
}

/** One in-memory replica set for the whole e2e run (transactions need a replica set). */
export default async function globalSetup(): Promise<void> {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  globalThis.__MONGO_REPLSET__ = replSet;
  process.env.MONGODB_URI = replSet.getUri('travel_platform_test');
}

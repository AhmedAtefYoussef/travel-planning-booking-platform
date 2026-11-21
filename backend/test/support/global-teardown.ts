export default async function globalTeardown(): Promise<void> {
  await globalThis.__MONGO_REPLSET__?.stop();
}

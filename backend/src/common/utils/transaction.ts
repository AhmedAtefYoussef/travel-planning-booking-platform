import type { ClientSession, Connection } from 'mongoose';

/**
 * Runs `work` in one MongoDB transaction on its own session and always ends the session.
 *
 * The driver's withTransaction retries `work` on a transient error and when the commit result is
 * unknown, so `work` must be safe to run again: re-read the clock and any state inside it rather
 * than in the caller. A duplicate-key error is not retried (see isReferenceCollision); it reaches the
 * caller unchanged, as does any other error `work` throws. Returns what the last, committed run of
 * `work` returned.
 */
export async function runInTransaction<T>(
  connection: Pick<Connection, 'startSession'>,
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await connection.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

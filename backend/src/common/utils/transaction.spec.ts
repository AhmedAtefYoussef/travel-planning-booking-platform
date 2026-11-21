import type { ClientSession, Connection } from 'mongoose';
import { runInTransaction } from './transaction';

function fakeConnection(attempts = 1) {
  const session = {
    withTransaction: jest.fn(async (fn: () => Promise<void>) => {
      // Like the driver on a transient error: run the callback again.
      for (let i = 0; i < attempts; i += 1) await fn();
    }),
    endSession: jest.fn(() => Promise.resolve()),
  };
  const connection = {
    startSession: jest.fn(() =>
      Promise.resolve(session as unknown as ClientSession),
    ),
  } as unknown as Pick<Connection, 'startSession'>;
  return { connection, session };
}

describe('runInTransaction', () => {
  it('passes its session to the work, returns its result and ends the session', async () => {
    const { connection, session } = fakeConnection();
    const seen: unknown[] = [];

    const result = await runInTransaction(connection, (s) => {
      seen.push(s);
      return Promise.resolve(42);
    });

    expect(result).toBe(42);
    expect(seen).toEqual([session]);
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('returns the result of the last run when the driver retries the work', async () => {
    const { connection } = fakeConnection(3);
    let run = 0;

    const result = await runInTransaction(connection, () => {
      run += 1;
      return Promise.resolve(run);
    });

    expect(result).toBe(3);
  });

  it('rethrows the error of the work unchanged and still ends the session', async () => {
    const { connection, session } = fakeConnection();
    const error = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
    });

    await expect(
      runInTransaction(connection, () => Promise.reject(error)),
    ).rejects.toBe(error);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });
});

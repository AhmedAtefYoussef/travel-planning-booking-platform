import type { ClientSession, Connection } from 'mongoose';
import { afterCommit, runInTransaction } from './transaction';

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

describe('afterCommit', () => {
  const settle = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };

  it('runs the hook once, only after the transaction committed', async () => {
    const { connection } = fakeConnection();
    const hook = jest.fn();

    await runInTransaction(connection, (session) => {
      afterCommit(session, hook);
      expect(hook).not.toHaveBeenCalled();
      return Promise.resolve();
    });
    await settle();

    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('drops the hook when the work throws (the transaction aborts)', async () => {
    const { connection } = fakeConnection();
    const hook = jest.fn();

    await expect(
      runInTransaction(connection, (session) => {
        afterCommit(session, hook);
        return Promise.reject(new Error('boom'));
      }),
    ).rejects.toThrow('boom');
    await settle();

    expect(hook).not.toHaveBeenCalled();
  });

  it('does not duplicate hooks when the driver retries the work', async () => {
    const { connection } = fakeConnection(3);
    const hook = jest.fn();

    await runInTransaction(connection, (session) => {
      afterCommit(session, hook);
      return Promise.resolve();
    });
    await settle();

    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('keeps hooks apart per transaction', async () => {
    const { connection } = fakeConnection();
    const first = jest.fn();
    const second = jest.fn();

    await runInTransaction(connection, (session) => {
      afterCommit(session, first);
      return Promise.resolve();
    });
    await runInTransaction(connection, (session) => {
      afterCommit(session, second);
      return Promise.resolve();
    });
    await settle();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('runs on the next tick when there is no session', async () => {
    const hook = jest.fn();

    afterCommit(undefined, hook);
    expect(hook).not.toHaveBeenCalled();
    await settle();

    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('drops the hook of a session that runInTransaction did not open', async () => {
    const hook = jest.fn();

    afterCommit({} as ClientSession, hook);
    await settle();

    expect(hook).not.toHaveBeenCalled();
  });

  it('swallows an error thrown by a hook', async () => {
    const { connection } = fakeConnection();
    const hook = jest.fn(() => Promise.reject(new Error('smtp down')));

    await runInTransaction(connection, (session) => {
      afterCommit(session, hook);
      return Promise.resolve();
    });
    await settle();

    expect(hook).toHaveBeenCalledTimes(1);
  });
});

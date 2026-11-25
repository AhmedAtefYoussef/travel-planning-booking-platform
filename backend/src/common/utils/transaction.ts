import { Logger } from '@nestjs/common';
import type { ClientSession, Connection } from 'mongoose';

type CommitHook = () => void | Promise<void>;

const logger = new Logger('Transaction');

/** Hooks of the attempt that is running now, per session opened by runInTransaction. */
const hooks = new WeakMap<ClientSession, CommitHook[]>();

/**
 * Runs `work` in one MongoDB transaction on its own session and always ends the session.
 *
 * The driver's withTransaction retries `work` on a transient error and when the commit result is
 * unknown, so `work` must be safe to run again: re-read the clock and any state inside it rather
 * than in the caller. A duplicate-key error is not retried (see isReferenceCollision); it reaches the
 * caller unchanged, as does any other error `work` throws. Returns what the last, committed run of
 * `work` returned.
 *
 * Side effects that must not happen unless the transaction commits (sending an email) go through
 * afterCommit(session, ...) instead of running inside `work`.
 */
export async function runInTransaction<T>(
  connection: Pick<Connection, 'startSession'>,
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await connection.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      // A retry starts from scratch: what an earlier attempt registered must not run.
      hooks.set(session, []);
      result = await work(session);
    });
    const committed = hooks.get(session) ?? [];
    hooks.delete(session);
    for (const hook of committed) fireAndForget(hook);
    return result;
  } finally {
    hooks.delete(session);
    await session.endSession();
  }
}

/**
 * Runs `hook` once, after the transaction that owns `session` commits. It is dropped when that
 * transaction aborts, and an attempt the driver retries registers its hooks again, so a hook never runs
 * twice. The hook is not awaited by the request (an SMTP server must not slow it down) and an error in it
 * is logged, never thrown.
 *
 * Without a session there is no transaction to wait for: the hook runs on the next tick. A session
 * that runInTransaction did not open (a bare `connection.transaction`) offers no commit signal, so the
 * hook is dropped with a warning rather than risk announcing a change that rolls back; use
 * runInTransaction wherever a hook is needed.
 */
export function afterCommit(
  session: ClientSession | undefined,
  hook: CommitHook,
): void {
  if (!session) {
    fireAndForget(hook);
    return;
  }
  const pending = hooks.get(session);
  if (!pending) {
    logger.warn(
      'afterCommit was called with a session not opened by runInTransaction; the hook was dropped',
    );
    return;
  }
  pending.push(hook);
}

function fireAndForget(hook: CommitHook): void {
  setImmediate(() => {
    void Promise.resolve()
      .then(hook)
      .catch((e: unknown) =>
        logger.error(
          'An after-commit hook failed',
          e instanceof Error ? e.stack : String(e),
        ),
      );
  });
}

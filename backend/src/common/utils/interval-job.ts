import {
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  NodeEnv,
  type EnvironmentVariables,
} from '../../config/env.validation';

/** One named unit of work a job runs; its failure is logged and never stops the other tasks. */
export interface JobTask {
  name: string;
  run: () => Promise<unknown>;
}

/**
 * Base for the periodic background jobs (booking lifecycle, payments, flight status, currency). It runs
 * the startup tasks once at bootstrap, then the tasks every `intervalMs`, on an unref'd timer so it never
 * keeps the process alive, and clears the timer at shutdown. Nothing starts under NODE_ENV=test: tests
 * call the job methods directly with a fixed `now`. No scheduler dependency is needed for this.
 *
 * Every task's failure is caught and logged with its stack, so one failing task neither crashes the
 * process nor stops the others or the next tick. Jobs must be safe to run on several API instances at
 * once (status-conditioned writes).
 */
export abstract class IntervalJob
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  protected readonly logger = new Logger(this.constructor.name);
  private timer?: NodeJS.Timeout;

  protected constructor(
    protected readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly intervalMs: number,
    /** Prefix of a failure message, e.g. "Payment job" gives `Payment job "x" failed: ...`. */
    private readonly label: string,
  ) {}

  /** The tasks run on every tick, in parallel. */
  protected abstract tasks(): JobTask[];

  /** The tasks run once at bootstrap; the tick's tasks unless a job needs a different first run. */
  protected startupTasks(): JobTask[] {
    return this.tasks();
  }

  /** Hook to scrub a failure's message and stack before they are logged (e.g. an API key). */
  protected redact(text: string): string {
    return text;
  }

  onApplicationBootstrap(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === NodeEnv.Test) return;
    void this.runAll(this.startupTasks());
    this.timer = setInterval(
      () => void this.runAll(this.tasks()),
      this.intervalMs,
    );
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private runAll(tasks: JobTask[]): Promise<unknown> {
    return Promise.all(
      tasks.map((task) =>
        task.run().catch((e: unknown) => this.logFailure(task.name, e)),
      ),
    );
  }

  private logFailure(name: string, e: unknown): void {
    const reason = e instanceof Error ? e.message : String(e);
    this.logger.error(
      this.redact(`${this.label} "${name}" failed: ${reason}`),
      e instanceof Error && e.stack ? this.redact(e.stack) : undefined,
    );
  }
}

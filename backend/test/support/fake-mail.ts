import { MAIL_SERVICE } from '../../src/common/contracts';
import type {
  MailMessage,
  MailService,
} from '../../src/common/contracts/mail.contract';
import type { ProviderOverride } from './create-test-app';

/**
 * In-memory SMTP for e2e tests (GEN-01-B): captures every message the app sends, so a test can assert
 * who was emailed and what the email says. No network. Pass `fakeMailOverride(mail)` to createTestApp.
 */
export class FakeMail implements MailService {
  readonly sent: MailMessage[] = [];
  /** Set to make the next send reject, like an SMTP outage. */
  failNext = false;

  send(message: MailMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('SMTP unavailable'));
    }
    this.sent.push(message);
    return Promise.resolve();
  }

  to(address: string): MailMessage[] {
    return this.sent.filter((m) => m.to === address);
  }

  /** Email is sent after the response, so wait until `count` messages went to `address`. */
  async waitFor(address: string, count = 1, timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.to(address).length < count) {
      if (Date.now() > deadline)
        throw new Error(
          `Expected ${count} email(s) to ${address}, got ${this.to(address).length}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /** Lets any late send arrive, for asserting that something was NOT (or not again) emailed. */
  settle(ms = 150): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function fakeMailOverride(mail: FakeMail): ProviderOverride {
  return { provide: MAIL_SERVICE, useValue: mail };
}

import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { MailMessage, MailService } from '../../common/contracts';

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

/**
 * MAIL_SERVICE over SMTP (nodemailer). In development the server is Mailpit (localhost:1025, inbox UI
 * on :8025), which accepts anything and delivers nothing outside the laptop. Timeouts are short so a
 * dead server cannot hold work for long.
 */
export class SmtpMailService implements MailService {
  private readonly transport: Transporter;

  constructor(private readonly settings: SmtpSettings) {
    this.transport = createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      ...(settings.user
        ? { auth: { user: settings.user, pass: settings.pass } }
        : {}),
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.settings.from, ...message });
  }
}

/** MAIL_SERVICE when MAIL_ENABLED=false: nothing leaves the process and no address is logged. */
export class DisabledMailService implements MailService {
  private readonly logger = new Logger('Mail');

  send(message: MailMessage): Promise<void> {
    this.logger.debug(
      `Email disabled (MAIL_ENABLED=false); not sending "${message.subject}"`,
    );
    return Promise.resolve();
  }
}

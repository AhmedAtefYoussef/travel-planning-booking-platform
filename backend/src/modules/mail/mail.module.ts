import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_NOTIFICATIONS, MAIL_SERVICE } from '../../common/contracts';
import type { EnvironmentVariables } from '../../config/env.validation';
import { EmailNotificationsService } from './email-notifications.service';
import { DisabledMailService, SmtpMailService } from './smtp-mail.service';

/**
 * Email (GEN-01-B). Global so notifications and users can inject EMAIL_NOTIFICATIONS. MAIL_ENABLED=false
 * (the default) installs a no-op transport, so nothing needs an SMTP server unless a developer opts in
 * (see docs/ONBOARDING.md, "Email (Mailpit)").
 */
@Global()
@Module({
  providers: [
    {
      provide: MAIL_SERVICE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        config.get('MAIL_ENABLED', { infer: true })
          ? new SmtpMailService({
              host: config.get('SMTP_HOST', { infer: true }),
              port: config.get('SMTP_PORT', { infer: true }),
              secure: config.get('SMTP_SECURE', { infer: true }),
              user: config.get('SMTP_USER', { infer: true }),
              pass: config.get('SMTP_PASS', { infer: true }),
              from: config.get('MAIL_FROM', { infer: true }),
            })
          : new DisabledMailService(),
    },
    EmailNotificationsService,
    { provide: EMAIL_NOTIFICATIONS, useExisting: EmailNotificationsService },
  ],
  exports: [MAIL_SERVICE, EMAIL_NOTIFICATIONS],
})
export class MailModule {}

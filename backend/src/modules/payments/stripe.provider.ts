import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/** DI token for the Stripe SDK client; tests override it with a mock. */
export const STRIPE_CLIENT = 'STRIPE_CLIENT';

export const stripeProvider = {
  provide: STRIPE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Stripe =>
    new Stripe(
      config.get<string>('STRIPE_SECRET_KEY') || 'sk_test_not_configured',
    ),
};

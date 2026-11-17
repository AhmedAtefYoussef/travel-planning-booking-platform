import { Module } from '@nestjs/common';
import { FlightsModule } from '../flights';
import { HotelsModule } from '../hotels';
import { AccountSuspensionsController } from './account-suspensions.controller';
import { AccountSuspensionsService } from './account-suspensions.service';
import { ProviderActivationController } from './provider-activation.controller';
import { ProviderActivationService } from './provider-activation.service';

/**
 * Admin actions on other modules' data (brief section 6.1): ACC-15 and ACC-16 suspensions and provider
 * deactivation now; GEN-10 reports and moderation join later. It owns no collection and reaches the
 * other modules only through common/contracts tokens: ACCOUNT_ADMIN (users, global), AIRLINE_STATUS
 * and HOTEL_STATUS (exported by the flights and hotels modules imported below), AUDIT_SERVICE and
 * NOTIFICATIONS_SERVICE (global).
 */
@Module({
  imports: [FlightsModule, HotelsModule],
  controllers: [AccountSuspensionsController, ProviderActivationController],
  providers: [AccountSuspensionsService, ProviderActivationService],
})
export class AdminModule {}

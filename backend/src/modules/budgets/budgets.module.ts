import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ITINERARY_BUDGETS } from '../../common/contracts/tokens';
import { ItinerariesModule } from '../itineraries';
import { ReferenceModule } from '../reference';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { ItineraryBudgetsPort } from './itinerary-budgets.port';
import { BudgetEntry, BudgetEntrySchema } from './schemas/budget-entry.schema';
import {
  TransportCost,
  TransportCostSchema,
} from './schemas/transport-cost.schema';

/**
 * Itinerary budgets (brief section 6.5). Both TRVL-143 collections are registered here so their indexes
 * are built at startup; ITN-16 transport costs come first, ITN-14 and ITN-18 follow in their own PRs.
 * Itinerary models come from ItinerariesModule (ownership, days); the currency module is global
 * (CURRENCY_SERVICE). Global so the itineraries module can inject ITINERARY_BUDGETS (ITN-01, ITN-07,
 * ITN-09, ITN-21) without importing this module.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BudgetEntry.name, schema: BudgetEntrySchema },
      { name: TransportCost.name, schema: TransportCostSchema },
    ]),
    ItinerariesModule,
    ReferenceModule,
  ],
  controllers: [BudgetsController],
  providers: [
    BudgetsService,
    ItineraryBudgetsPort,
    { provide: ITINERARY_BUDGETS, useExisting: ItineraryBudgetsPort },
  ],
  exports: [ITINERARY_BUDGETS],
})
export class BudgetsModule {}

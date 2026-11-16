import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Itinerary, ItinerarySchema } from '../itineraries';
import { ReferenceModule } from '../reference';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { BudgetEntry, BudgetEntrySchema } from './schemas/budget-entry.schema';
import {
  TransportCost,
  TransportCostSchema,
} from './schemas/transport-cost.schema';

/**
 * Itinerary budgets (brief section 6.5). Both TRVL-143 collections are registered here so their indexes
 * are built at startup; ITN-16 transport costs come first, ITN-14 and ITN-18 follow in their own PRs.
 * Itineraries are a read model for ownership and days; the currency module is global (CURRENCY_SERVICE).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BudgetEntry.name, schema: BudgetEntrySchema },
      { name: TransportCost.name, schema: TransportCostSchema },
      { name: Itinerary.name, schema: ItinerarySchema },
    ]),
    ReferenceModule,
  ],
  controllers: [BudgetsController],
  providers: [BudgetsService],
})
export class BudgetsModule {}

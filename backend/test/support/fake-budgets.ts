import { Global, Module } from '@nestjs/common';
import type {
  ItineraryBudgets,
  ItineraryDayBudget,
} from '../../src/common/contracts/services.contract';
import { ITINERARY_BUDGETS } from '../../src/common/contracts/tokens';
import type { ProviderOverride } from './create-test-app';

/**
 * Stands in for Malak's budgets module (ITN-14/ITN-16) behind the ITINERARY_BUDGETS port, so the
 * itinerary suites can check budget subtotals and clean-up before that module provides the port.
 */
export const budgetRows = new Map<string, ItineraryDayBudget[]>();
export const deletedDays: { itineraryId: string; dayIds: string[] }[] = [];

export const fakeBudgets: ItineraryBudgets = {
  dayTotals: (itineraryId) =>
    Promise.resolve(budgetRows.get(itineraryId) ?? []),
  deleteForDays: (itineraryId, dayIds) => {
    deletedDays.push({ itineraryId, dayIds });
    budgetRows.set(
      itineraryId,
      (budgetRows.get(itineraryId) ?? []).filter(
        (r) => !dayIds.includes(r.dayId),
      ),
    );
    return Promise.resolve();
  },
  deleteForItinerary: (itineraryId) => {
    budgetRows.delete(itineraryId);
    return Promise.resolve();
  },
  cloneForItinerary: () => Promise.resolve(),
};

@Global()
@Module({
  providers: [{ provide: ITINERARY_BUDGETS, useValue: fakeBudgets }],
  exports: [ITINERARY_BUDGETS],
})
export class FakeBudgetsModule {}

/**
 * Pass with FakeBudgetsModule: the module provides the token while no real budgets module exists, and
 * the override replaces the real one once it does (a second global provider would be ignored).
 */
export const budgetOverrides: ProviderOverride[] = [
  { provide: ITINERARY_BUDGETS, useValue: fakeBudgets },
];

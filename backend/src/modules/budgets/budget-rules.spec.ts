import {
  emptyByCategory,
  groupBudgetItems,
  INTERCITY_TRANSPORT,
  SUMMARY_CATEGORIES,
} from './budget-rules';
import { BudgetCategory } from './schemas/budget-entry.schema';

describe('budget rules (ITN-14, ITN-18)', () => {
  it('sums items per day, category and currency before any conversion', () => {
    const groups = groupBudgetItems([
      {
        dayId: 'd1',
        category: BudgetCategory.Food,
        amountMinor: 100,
        currency: 'EGP',
      },
      {
        dayId: 'd1',
        category: BudgetCategory.Food,
        amountMinor: 250,
        currency: 'EGP',
      },
      {
        dayId: 'd1',
        category: BudgetCategory.Food,
        amountMinor: 5,
        currency: 'USD',
      },
      {
        dayId: 'd2',
        category: BudgetCategory.Food,
        amountMinor: 7,
        currency: 'EGP',
      },
      {
        dayId: 'd1',
        category: INTERCITY_TRANSPORT,
        amountMinor: 9,
        currency: 'EGP',
      },
    ]);
    expect(groups).toEqual([
      { dayId: 'd1', category: 'FOOD', amountMinor: 350, currency: 'EGP' },
      { dayId: 'd1', category: 'FOOD', amountMinor: 5, currency: 'USD' },
      { dayId: 'd2', category: 'FOOD', amountMinor: 7, currency: 'EGP' },
      {
        dayId: 'd1',
        category: 'INTERCITY_TRANSPORT',
        amountMinor: 9,
        currency: 'EGP',
      },
    ]);
  });

  it('does not change the input items', () => {
    const items = [
      {
        dayId: 'd1',
        category: BudgetCategory.Food,
        amountMinor: 1,
        currency: 'EGP',
      },
      {
        dayId: 'd1',
        category: BudgetCategory.Food,
        amountMinor: 2,
        currency: 'EGP',
      },
    ];
    groupBudgetItems(items);
    expect(items[0].amountMinor).toBe(1);
  });

  it('starts every summary category at zero', () => {
    const totals = emptyByCategory();
    expect(Object.keys(totals)).toEqual([...SUMMARY_CATEGORIES]);
    expect(Object.values(totals).every((v) => v === 0)).toBe(true);
  });
});

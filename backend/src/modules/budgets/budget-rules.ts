import { BudgetCategory } from './schemas/budget-entry.schema';

/** Summary buckets: the four ITN-14 categories plus intercity transport (ITN-16). */
export const INTERCITY_TRANSPORT = 'INTERCITY_TRANSPORT' as const;
export type SummaryCategory = BudgetCategory | typeof INTERCITY_TRANSPORT;
export const SUMMARY_CATEGORIES: readonly SummaryCategory[] = [
  ...Object.values(BudgetCategory),
  INTERCITY_TRANSPORT,
];

/** One amount that counts toward the itinerary budget, in its own currency. */
export interface BudgetItem {
  dayId: string;
  category: SummaryCategory;
  amountMinor: number;
  currency: string;
}

/** Sum of the items sharing a day, category and currency: converted as one amount. */
export type BudgetGroup = BudgetItem;

/**
 * Adds up items per (day, category, currency) before any conversion, so each amount is
 * converted once per group and rounding happens as few times as possible (ITN-18).
 */
export function groupBudgetItems(items: readonly BudgetItem[]): BudgetGroup[] {
  const groups = new Map<string, BudgetGroup>();
  for (const item of items) {
    const key = `${item.dayId}|${item.category}|${item.currency}`;
    const group = groups.get(key);
    if (group) group.amountMinor += item.amountMinor;
    else groups.set(key, { ...item });
  }
  return [...groups.values()];
}

/** An empty total per summary category. */
export function emptyByCategory(): Record<SummaryCategory, number> {
  return Object.fromEntries(SUMMARY_CATEGORIES.map((c) => [c, 0])) as Record<
    SummaryCategory,
    number
  >;
}

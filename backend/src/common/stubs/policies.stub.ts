import { Injectable } from '@nestjs/common';
import {
  PoliciesProvider,
  ProviderPolicies,
  RefundTier,
} from '../contracts/policies.contract';

const DEFAULT_TIERS: RefundTier[] = [
  { daysBefore: 14, refundPercent: 100 },
  { daysBefore: 7, refundPercent: 50 },
  { daysBefore: 2, refundPercent: 25 },
];

/**
 * Stand-in for the airline / hotel policy endpoints (contract 5). Provider
 * ids starting with "hotel" get hotel policies; anything else is an airline.
 * Override per test with `set()`.
 */
@Injectable()
export class PoliciesStub implements PoliciesProvider {
  private readonly overrides = new Map<string, ProviderPolicies>();

  set(policies: ProviderPolicies): void {
    this.overrides.set(policies.providerId, policies);
  }

  getPolicies(providerId: string): Promise<ProviderPolicies> {
    const override = this.overrides.get(providerId);
    if (override) return Promise.resolve(override);

    if (providerId.startsWith('hotel')) {
      return Promise.resolve({
        kind: 'HOTEL',
        providerId,
        tiers: DEFAULT_TIERS.map((t) => ({ ...t })),
        checkInTime: '14:00',
        checkOutTime: '12:00',
      });
    }
    return Promise.resolve({
      kind: 'AIRLINE',
      providerId,
      tiers: DEFAULT_TIERS.map((t) => ({ ...t })),
      extraBaggage: { pricePerUnitMinor: 1500, unit: 'KG', maxUnits: 20 },
      cabins: [
        { cabin: 'ECONOMY', freeBaggageKg: 23 },
        { cabin: 'BUSINESS', freeBaggageKg: 32 },
      ],
    });
  }
}

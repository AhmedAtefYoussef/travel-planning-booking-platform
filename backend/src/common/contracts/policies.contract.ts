/**
 * Provider policies shown and accepted before payment (PAY-02) and snapshotted onto each booking, so a
 * later policy change never alters an existing booking's refund (brief section 6.4).
 */

/** One tier: cancelling at least `daysBefore` days ahead refunds `refundPercent` (FLT-09, HTL-10). */
export interface CancellationTier {
  /** Integer >= 0, unique within a policy. */
  daysBefore: number;
  /** 0..100, up to two decimals. */
  refundPercent: number;
}

/** FLT-08: extra bags priced per bag, capped per passenger. */
export interface ExtraBaggagePolicy {
  /** > 0, minor units of PLATFORM_CURRENCY. */
  pricePerBagMinor: number;
  /** >= 0 */
  maxExtraBagsPerPassenger: number;
}

/** Per-cabin free allowance (FLT-04); each extra bag has the same max weight (FLT-08). */
export interface CabinBaggageAllowance {
  cabinClass: string;
  freeBags: number;
  maxKgPerBag: number;
}

export interface AirlinePolicy {
  cancellationTiers: CancellationTier[];
  extraBaggage: ExtraBaggagePolicy;
  cabins: CabinBaggageAllowance[];
}

export interface HotelPolicy {
  cancellationTiers: CancellationTier[];
  /** "HH:mm" in the hotel's local time (HTL-09). */
  checkInTime: string;
  checkOutTime: string;
}

/**
 * FLT-09 selection rule (HTL-10 reuses it): the tier with the highest threshold not exceeding the days
 * remaining; if no tier applies the refund is 0%. Returns null when no tier applies.
 */
export function selectCancellationTier(
  tiers: readonly CancellationTier[],
  daysRemaining: number,
): CancellationTier | null {
  let best: CancellationTier | null = null;
  for (const tier of tiers) {
    if (
      tier.daysBefore <= daysRemaining &&
      (!best || tier.daysBefore > best.daysBefore)
    ) {
      best = tier;
    }
  }
  return best;
}

/** Validation shared by the airline and hotel policy DTOs: unique integer thresholds, 0..100 %. */
export function cancellationTierErrors(
  tiers: readonly CancellationTier[],
): string[] {
  const errors: string[] = [];
  const seen = new Set<number>();
  tiers.forEach((t, i) => {
    if (!Number.isInteger(t.daysBefore) || t.daysBefore < 0) {
      errors.push(`tiers[${i}].daysBefore must be an integer >= 0`);
    }
    if (
      !Number.isFinite(t.refundPercent) ||
      t.refundPercent < 0 ||
      t.refundPercent > 100
    ) {
      errors.push(`tiers[${i}].refundPercent must be between 0 and 100`);
    }
    if (seen.has(t.daysBefore))
      errors.push(`tiers[${i}].daysBefore ${t.daysBefore} is duplicated`);
    seen.add(t.daysBefore);
  });
  return errors;
}

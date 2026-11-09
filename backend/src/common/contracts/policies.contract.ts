/** Contract 5 - Policies (Joudy, Sandra -> Ahmed, Karim). */

/**
 * One cancellation tier. The applicable tier is the one with the highest
 * `daysBefore` that is <= daysRemaining; if none applies the refund is 0%.
 */
export interface RefundTier {
  daysBefore: number;
  /** 0..100 */
  refundPercent: number;
}

export interface CabinBaggage {
  cabin: string;
  freeBaggageKg: number;
}

export interface ExtraBaggagePolicy {
  /** Price per extra kg (or per bag) in PLATFORM_CURRENCY minor units. */
  pricePerUnitMinor: number;
  unit: 'KG' | 'BAG';
  maxUnits: number;
}

export interface AirlinePolicies {
  kind: 'AIRLINE';
  providerId: string;
  tiers: RefundTier[];
  extraBaggage: ExtraBaggagePolicy | null;
  cabins: CabinBaggage[];
}

export interface HotelPolicies {
  kind: 'HOTEL';
  providerId: string;
  tiers: RefundTier[];
  /** Local time "HH:mm" in the hotel's time zone. */
  checkInTime: string;
  checkOutTime: string;
}

export type ProviderPolicies = AirlinePolicies | HotelPolicies;

/** Frozen copy stored on the booking when the user accepts policies. */
export type PolicySnapshot = ProviderPolicies & {
  acceptedAt: Date;
  /** IANA zone used for daysRemaining (departure airport / hotel). */
  timeZone: string;
};

export interface PoliciesProvider {
  /** Throws NotFoundException for an unknown provider. */
  getPolicies(providerId: string): Promise<ProviderPolicies>;
}

import type { ClientSession } from 'mongoose';
import type { Role } from '../auth/auth.types';
import type { Page } from '../pagination/pagination';

/* ----------------------------------------------------------------------------------------------
 * Search (FLT-11/FLT-12/FLT-15 by Joudy & Ahmed, HTL-11/HTL-12 by Sandra) reused by itineraries
 * (ITN-25, ITN-26 by Sarah). Register under FLIGHTS_SEARCH / HOTELS_SEARCH.
 * -------------------------------------------------------------------------------------------- */

export type CabinClass = 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';

export interface FlightSearchQuery {
  /** IATA codes from the reference airports (FLT-02). */
  from: string;
  to: string;
  /** Local departure date at the origin airport, YYYY-MM-DD (FLT-11). */
  departureDate: string;
  /** Present for round trips (FLT-12). */
  returnDate?: string;
  adults: number;
  children?: number;
  infants?: number;
  cabinClass?: CabinClass;
  /** FLT-15: inclusive range on the fare per passenger, minor units. */
  minPriceMinor?: number;
  maxPriceMinor?: number;
  sort?: 'price' | 'duration' | 'departure';
  page: number;
}

export interface FlightSearchResult {
  flightId: string;
  airlineId: string;
  flightNumber: string;
  from: string;
  to: string;
  /** UTC instants; display with the airport time zones (GEN-06). */
  departureUtc: Date;
  arrivalUtc: Date;
  durationMinutes: number;
  cabinClass: CabinClass;
  seatsLeft: number;
  /** Total for the requested passengers, minor units (PAY-04). */
  totalPriceMinor: number;
}

export interface FlightsSearch {
  search(query: FlightSearchQuery): Promise<Page<FlightSearchResult>>;
}

export interface HotelSearchQuery {
  cityId?: string;
  countryCode?: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  minRating?: number;
  sort?: 'price' | 'rating';
  page: number;
}

export interface HotelSearchResult {
  hotelId: string;
  name: string;
  cityId: string;
  averageRating: number | null;
  /** Cheapest available stay total for the dates, minor units. */
  fromPriceMinor: number;
}

export interface HotelsSearch {
  search(query: HotelSearchQuery): Promise<Page<HotelSearchResult>>;
}

/* ----------------------------------------------------------------------------------------------
 * Currency (ITN-18, Ahmed -> Malak). Register under CURRENCY_SERVICE.
 * -------------------------------------------------------------------------------------------- */

export interface Conversion {
  amountMinor: number;
  rate: number;
  /** Day of the cached rate shown to the user (ITN-18), YYYY-MM-DD. */
  rateDate: string;
}

export interface CurrencyService {
  /**
   * Converts using the latest cached daily rate. Throws 400 for an unsupported code and
   * 503 EXCHANGE_RATE_UNAVAILABLE when no rate exists (never converts with a missing rate).
   */
  convert(amountMinor: number, from: string, to: string): Promise<Conversion>;
  supportedCurrencies(): Promise<string[]>;
}

/* ----------------------------------------------------------------------------------------------
 * Reference data (GEN-12, FLT-02, Joudy -> all). Seeded from the official datasets; ids are the
 * dataset ids (IATA code, city_id, ISO country code). Register under REFERENCE_SERVICE.
 * -------------------------------------------------------------------------------------------- */

export interface Country {
  code: string;
  name: string;
  currency: string;
}
export interface City {
  cityId: string;
  name: string;
  countryCode: string;
}
export interface Airport {
  iataCode: string;
  name: string;
  cityId: string;
  countryCode: string;
  /** IANA zone, e.g. Africa/Cairo (GEN-06). */
  timeZone: string;
}
export interface Attraction {
  attractionId: string;
  name: string;
  cityId: string;
}

export interface ReferenceService {
  getAirport(iataCode: string): Promise<Airport | null>;
  getCity(cityId: string): Promise<City | null>;
  getCountry(code: string): Promise<Country | null>;
  listAirports(): Promise<Airport[]>;
  listCities(countryCode?: string): Promise<City[]>;
  listCountries(): Promise<Country[]>;
  listAttractions(cityId: string): Promise<Attraction[]>;
}

/* ----------------------------------------------------------------------------------------------
 * Audit (GEN-07, TRVL-162). Append-only. Implemented in modules/audit. Register under AUDIT_SERVICE.
 * -------------------------------------------------------------------------------------------- */

export enum AuditAction {
  CreateModerator = 'CREATE_MODERATOR',
  ResetPassword = 'RESET_PASSWORD',
  SuspendAccount = 'SUSPEND_ACCOUNT',
  ReactivateAccount = 'REACTIVATE_ACCOUNT',
  DeactivateProvider = 'DEACTIVATE_PROVIDER',
  ReactivateProvider = 'REACTIVATE_PROVIDER',
  ResolveReport = 'RESOLVE_REPORT',
  HideContent = 'HIDE_CONTENT',
  DeleteContent = 'DELETE_CONTENT',
}

export enum AuditTargetType {
  User = 'USER',
  Airline = 'AIRLINE',
  Hotel = 'HOTEL',
  Report = 'REPORT',
  Post = 'POST',
  Comment = 'COMMENT',
  Review = 'REVIEW',
  Itinerary = 'ITINERARY',
}

export interface AuditEntry {
  actor: { id: string; role: Role };
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  reason?: string;
  /** Small before/after summary. Never secrets or passwords. */
  metadata?: Record<string, unknown>;
}

export interface AuditService {
  /** Pass the caller's session so the audit entry commits or aborts with the admin action. */
  record(entry: AuditEntry, session?: ClientSession): Promise<void>;
}

/* ----------------------------------------------------------------------------------------------
 * Notifications (GEN-01, Karim). Register under NOTIFICATIONS_SERVICE.
 * -------------------------------------------------------------------------------------------- */

export enum NotificationType {
  BookingConfirmed = 'BOOKING_CONFIRMED',
  BookingCancelled = 'BOOKING_CANCELLED',
  RefundIssued = 'REFUND_ISSUED',
  RefundUpdated = 'REFUND_UPDATED',
  FlightScheduleChanged = 'FLIGHT_SCHEDULE_CHANGED',
  AccountSuspended = 'ACCOUNT_SUSPENDED',
  AccountReactivated = 'ACCOUNT_REACTIVATED',
  ProviderDeactivated = 'PROVIDER_DEACTIVATED',
  ProviderReactivated = 'PROVIDER_REACTIVATED',
}

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Frontend route to open, e.g. /bookings/flights/<id>. */
  link?: string;
}

export interface NotificationsService {
  notify(input: NotificationInput, session?: ClientSession): Promise<void>;
  notifyMany(
    inputs: NotificationInput[],
    session?: ClientSession,
  ): Promise<void>;
}

/* ----------------------------------------------------------------------------------------------
 * Uploads (GEN-08). Register under UPLOADS_SERVICE.
 * -------------------------------------------------------------------------------------------- */

export const UPLOAD_LIMITS = {
  mimeTypes: ['image/jpeg', 'image/png'] as const,
  maxBytes: 5 * 1024 * 1024,
  /** Posts, activities and hotels. */
  maxImagesPerEntity: 5,
  maxAirlineLogos: 1,
} as const;

export type UploadEntityType = 'POST' | 'ACTIVITY' | 'HOTEL' | 'AIRLINE_LOGO';

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface StoredImage {
  imageId: string;
  /** Public URL served by the backend, e.g. /uploads/posts/<file>.jpg */
  url: string;
}

export interface UploadsService {
  /**
   * Validates type (by content, not just extension), size and the per-entity limit, given how many
   * images the entity already has; rejects the whole batch with 400 on any violation.
   */
  saveImages(
    files: UploadedFileLike[],
    target: {
      entityType: UploadEntityType;
      entityId: string;
      existingCount: number;
    },
  ): Promise<StoredImage[]>;
  deleteImage(url: string): Promise<void>;
}

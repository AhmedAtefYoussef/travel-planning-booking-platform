import type { ClientSession } from 'mongoose';
import type {
  AirlinePolicySnapshot,
  HotelPolicySnapshot,
} from './policies.contract';
import type { AuthUser, ProviderType, Role } from '../auth/auth.types';
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
  /**
   * Refused by search() (a 400 on returnDate): the contract is one way. Round trips are two searches,
   * or GET /api/flights/search/round-trip (FLT-12).
   */
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
/** A seeded currency (GEN-12) with its minor-unit digits (USD 2, JPY 0), used by ITN-18 conversion. */
export interface CurrencyInfo {
  code: string;
  name: string;
  minorUnits: number;
}

export interface ReferenceService {
  getAirport(iataCode: string): Promise<Airport | null>;
  getCity(cityId: string): Promise<City | null>;
  getCountry(code: string): Promise<Country | null>;
  /** The known cities among `cityIds`, in one query; unknown ids are simply absent. */
  getCities(cityIds: readonly string[]): Promise<City[]>;
  /** The known countries among `codes` (case-insensitive), in one query; unknown codes are absent. */
  getCountries(codes: readonly string[]): Promise<Country[]>;
  listAirports(): Promise<Airport[]>;
  /** The airports of these cities, by IATA code, in one query. */
  listAirportsInCities(cityIds: readonly string[]): Promise<Airport[]>;
  listCities(countryCode?: string): Promise<City[]>;
  listCountries(): Promise<Country[]>;
  listAttractions(cityId: string): Promise<Attraction[]>;
  /** Seeded currencies sorted by code (ITN-18, PAY-04). */
  listCurrencies(): Promise<CurrencyInfo[]>;
}

/* ----------------------------------------------------------------------------------------------
 * Audit (GEN-07, TRVL-162). Append-only. Implemented in modules/audit. Register under AUDIT_SERVICE.
 * -------------------------------------------------------------------------------------------- */

export enum AuditAction {
  CreateModerator = 'CREATE_MODERATOR',
  /** FLT-01 / HTL-01: an admin created an airline or a hotel (target AIRLINE or HOTEL). */
  CreateProvider = 'CREATE_PROVIDER',
  ResetPassword = 'RESET_PASSWORD',
  SuspendAccount = 'SUSPEND_ACCOUNT',
  ReactivateAccount = 'REACTIVATE_ACCOUNT',
  DeactivateProvider = 'DEACTIVATE_PROVIDER',
  ReactivateProvider = 'REACTIVATE_PROVIDER',
  ResolveReport = 'RESOLVE_REPORT',
  HideContent = 'HIDE_CONTENT',
  DeleteContent = 'DELETE_CONTENT',
  /** HTL-26: a hotel moderator replied to (or edited the reply to) a review (target REVIEW). */
  ReplyReview = 'REPLY_REVIEW',
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
 * Notifications (GEN-01, Ahmed). Register under NOTIFICATIONS_SERVICE.
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
 * Flight bookings lookup (FLT-05 needs it; Karim's flight-bookings module provides it).
 * Register under FLIGHT_BOOKINGS_LOOKUP. Until it is provided, schedule changes are saved but no
 * notifications are sent (the flights module injects it as optional and logs a warning).
 * -------------------------------------------------------------------------------------------- */

export interface ConfirmedFlightBooking {
  bookingId: string;
  /** The account that made the booking; it receives the in-app notification. */
  userId: string;
}

export interface FlightBookingsLookup {
  /** Bookings on this flight whose status is Confirmed (GEN-11). */
  confirmedBookings(flightId: string): Promise<ConfirmedFlightBooking[]>;
}

/* ----------------------------------------------------------------------------------------------
 * Flight booking cancellations (FLT-06). The bookings module provides it under
 * FLIGHT_BOOKING_CANCELLATIONS; the flights module calls it right after it marks a flight Cancelled.
 * It is required (not optional): a flight must never be cancelled without its bookings and refunds.
 * -------------------------------------------------------------------------------------------- */

/** What one sweep over a cancelled flight's bookings did. */
export interface FlightCancellationOutcome {
  /** Confirmed bookings now Cancelled, each with its 100% refund and notification (PAY-03, GEN-01). */
  bookingsCancelled: number;
  /** Of those, how many recorded a refund (a booking paid 0 records none). */
  refundsRecorded: number;
  /** Unpaid holds ended (Pending Payment -> Expired) with their seats released. */
  holdsReleased: number;
  /** Bookings or holds that failed and are left as they were; sweeping again retries them. */
  failed: number;
}

export interface FlightBookingCancellations {
  /**
   * FLT-06: for a flight that is already Cancelled, first ends every unpaid hold on it (Pending Payment
   * -> Expired, seats released: a hold can no longer be confirmed, and a payment captured later is
   * refunded in full by PAY-01), then cancels every Confirmed booking on it as the provider (100%
   * refund, BOOKING_CANCELLED notice; a round trip is cancelled as a whole). Each booking is its own
   * transaction; one failing is logged and counted, never stops the others. Idempotent: a second sweep
   * finds nothing left to do, or retries what failed.
   */
  cancelAllForFlight(
    flightId: string,
    now?: Date,
  ): Promise<FlightCancellationOutcome>;
}

/* ----------------------------------------------------------------------------------------------
 * Flight inventory (FLT-22). The flights module owns the seat counters; bookings reserve and release
 * seats only through this contract, inside the caller's transaction (ADR-0002). Register under
 * FLIGHT_INVENTORY.
 * -------------------------------------------------------------------------------------------- */

export interface BookableCabin {
  flightId: string;
  airlineId: string;
  flightNumber: string;
  /** IATA codes. */
  from: string;
  to: string;
  departureUtc: Date;
  arrivalUtc: Date;
  /** Departure date in the departure airport's zone, YYYY-MM-DD (passenger ages are taken on it). */
  departureLocalDate: string;
  cabinId: string;
  cabinClass: CabinClass;
  /** Fare per adult or child seat, minor units. */
  fareMinor: number;
  seatsAvailable: number;
  /** FLT-08: null when the airline sells no extra bags. */
  extraBaggage: {
    pricePerBagMinor: number;
    maxExtraBagsPerPassenger: number;
  } | null;
  /** FLT-04/FLT-08: the cabin's weight limit per bag, which also applies to each extra bag. */
  maxKgPerBag: number;
  /**
   * Why it cannot be booked now (flight not Scheduled, already departed, airline deactivated), or null
   * when it can.
   */
  unavailableReason: string | null;
}

export interface FlightInventory {
  /** The flight and cabin as a booking needs them, or null when either does not exist. */
  getBookableCabin(
    flightId: string,
    cabinId: string,
    now: Date,
  ): Promise<BookableCabin | null>;
  /**
   * Atomically takes `seats` seats only if that many remain on a Scheduled flight (one conditional
   * update). Returns false, changing nothing, when they do not.
   */
  reserveSeats(
    flightId: string,
    cabinId: string,
    seats: number,
    session?: ClientSession,
  ): Promise<boolean>;
  /** PAY-02: the airline's current terms for this flight and cabin, or null when either is gone. */
  getAirlinePolicy(
    flightId: string,
    cabinId: string,
  ): Promise<AirlinePolicySnapshot | null>;
  /**
   * Gives seats back after an expired hold or a cancellation. Returns false when the flight or cabin no
   * longer exists, so the caller can report it instead of silently losing the seats.
   */
  releaseSeats(
    flightId: string,
    cabinId: string,
    seats: number,
    session?: ClientSession,
  ): Promise<boolean>;
}

/* ----------------------------------------------------------------------------------------------
 * Hotel inventory (HTL-18). The hotels module owns rooms and room_nights; bookings hold, book and
 * release nights only through this contract, inside the caller's transaction (ADR-0002). Register
 * under HOTEL_INVENTORY.
 * -------------------------------------------------------------------------------------------- */

export interface BookableRoom {
  roomId: string;
  number: string;
  maxOccupancy: number;
  /** Price per night now, minor units (HTL-03). The hold stores the price it read in its transaction. */
  priceMinor: number;
  /** Why it cannot be booked for the stay (deactivated, not bookable on some night), or null. */
  unavailableReason: string | null;
}

export interface BookableStay {
  hotelId: string;
  hotelName: string;
  /** The hotel's IANA zone; room_nights dates and "today" are in it. Null when the city has none. */
  timeZone: string | null;
  /** In the order requested; null where the id is not a room of this hotel. */
  rooms: (BookableRoom | null)[];
  /** Why the hotel takes no bookings (ACC-15 deactivated), or null. */
  unavailableReason: string | null;
}

/** One room's nights for a hold, with the price the hold read inside its transaction. */
export interface HeldRoom {
  roomId: string;
  number: string;
  maxOccupancy: number;
  priceMinor: number;
}

export interface HotelInventory {
  /** The hotel and the requested rooms as a booking needs them, or null when the hotel does not exist. */
  getBookableStay(
    hotelId: string,
    roomIds: string[],
    nights: string[],
  ): Promise<BookableStay | null>;
  /**
   * Holds every night of every room for one reservation, or throws and holds nothing. Inside `session`
   * it first writes each room (`$inc reservationVersion`, so it conflicts with an HTL-05 availability
   * replace), then re-reads the rooms and checks they are active and bookable on every night, then
   * inserts the HELD nights (the unique {roomId, date} index rejects any overlap). Throws 409
   * INSUFFICIENT_INVENTORY naming the taken nights, or 409 CONFLICT when a room changed.
   */
  holdNights(
    input: {
      hotelId: string;
      roomIds: string[];
      nights: string[];
      reservationId: string;
      expiresAt: Date;
    },
    session: ClientSession,
  ): Promise<HeldRoom[]>;
  /** Reservations whose HELD nights on these rooms and dates expired at or before `now`. */
  staleHolders(
    roomIds: string[],
    nights: string[],
    now: Date,
    session: ClientSession,
  ): Promise<string[]>;
  /** HELD -> BOOKED for every night of the reservation (HTL-17). Returns how many nights changed. */
  bookNights(
    reservationId: string,
    reference: string,
    session: ClientSession,
  ): Promise<number>;
  /** PAY-02: the hotel's current terms, or null when the hotel is gone. */
  getHotelPolicy(hotelId: string): Promise<HotelPolicySnapshot | null>;
  /**
   * Deletes the reservation's nights of one kind and returns how many were released: HELD (default) for
   * a hold that expires (HTL-18), BOOKED for a confirmed reservation that is cancelled (HTL-21).
   */
  releaseNights(
    reservationId: string,
    session: ClientSession,
    kind?: 'HELD' | 'BOOKED',
  ): Promise<number>;
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

/* ----------------------------------------------------------------------------------------------
 * Sessions (ACC-06, Abdelrahman). Register under SESSION_VALIDATOR; the users module provides it and
 * the global AuthGuard (common/auth) calls it on every request authenticated by the access cookie.
 * -------------------------------------------------------------------------------------------- */

/** Account status values as seen by the guard (the users module owns the AccountStatus enum). */
export type SessionAccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

/**
 * Result of a session check. When valid, `user` is rebuilt from the database (ACC-11), so a role or
 * provider change applies from the next request, not only after the access token expires.
 */
export type SessionCheck =
  | { valid: false }
  | {
      valid: true;
      user: AuthUser;
      status: SessionAccountStatus;
      /** ACC-07a, ACC-13: a temporary password must be replaced before anything else. */
      mustChangePassword: boolean;
    };

export interface SessionValidator {
  /**
   * Atomically checks that the session belongs to the user, is not revoked, has not expired and saw an
   * authenticated request within SESSION_IDLE_MINUTES, and if so records this request as its latest
   * activity (ACC-06); then loads the account (ACC-11). `valid: false` when the session can no longer
   * be used (logged out, idle, expired) or the account no longer exists.
   */
  touch(sessionId: string, userId: string): Promise<SessionCheck>;

  /**
   * Status of an existing account, or null when no account has this id. Used for x-dev-user stub
   * callers (TRVL-131), so a stub request naming a real account gets the same ACC-11 status and
   * ACC-07a forced-change checks as a cookie request. Never touches a session.
   */
  accountOf(userId: string): Promise<{
    status: SessionAccountStatus;
    mustChangePassword: boolean;
  } | null>;
}

/* ----------------------------------------------------------------------------------------------
 * Upcoming bookings (ACC-12 needs it). The bookings module provides it under UPCOMING_BOOKINGS as one
 * provider covering flights and hotels. The users module requires it: an app without it fails at boot
 * rather than letting deactivation ignore bookings.
 * -------------------------------------------------------------------------------------------- */

export interface UpcomingBookings {
  /**
   * How many of the user's bookings block self-deactivation (ACC-12), counting flights and hotels:
   * Confirmed (GEN-11) and not yet finished (endsAt after `now`; a trip in progress still counts), plus
   * Pending Payment within an unexpired hold, because a payment made just before deactivating can still
   * be confirmed by the webhook. Throws on a malformed id (fail closed).
   */
  countUpcomingConfirmed(userId: string, now: Date): Promise<number>;
}

/* ----------------------------------------------------------------------------------------------
 * Account administration (ACC-15, ACC-16). The users module owns accounts and sessions and provides
 * this under ACCOUNT_ADMIN. The admin module suspends and reactivates through it inside its own
 * transaction, so the status change, the session revocation, the audit entry (GEN-07) and the
 * notification (GEN-01) commit together or not at all.
 * -------------------------------------------------------------------------------------------- */

export interface AdministeredAccount {
  id: string;
  name: string;
  role: Role;
  status: SessionAccountStatus;
}

export interface AccountAdmin {
  /** The account, or null when no account has this id. */
  find(
    userId: string,
    session?: ClientSession,
  ): Promise<AdministeredAccount | null>;
  /**
   * Status-conditioned update (`{ _id, status: from }`). Returns false, changing nothing, when the
   * account is no longer in `from` (another admin changed it first).
   */
  changeStatus(
    userId: string,
    from: SessionAccountStatus,
    to: SessionAccountStatus,
    session: ClientSession,
  ): Promise<boolean>;
  /** Ends every open session of the account: its cookies and refresh tokens stop working at once. */
  revokeAllSessions(userId: string, session: ClientSession): Promise<void>;
  /** Ids of the moderators assigned to this airline or hotel (ACC-13), whatever their status. */
  moderatorsOf(
    type: ProviderType,
    providerId: string,
    session?: ClientSession,
  ): Promise<string[]>;
}

/* ----------------------------------------------------------------------------------------------
 * Provider status (ACC-15). The flights module provides it for airlines under AIRLINE_STATUS and the
 * hotels module for hotels under HOTEL_STATUS. Deactivation only flips `isActive`: search and booking
 * already read it (ACTIVE_PROVIDER_FILTER, FLIGHT_INVENTORY, HOTEL_INVENTORY), and Confirmed bookings
 * are never touched.
 * -------------------------------------------------------------------------------------------- */

export interface ProviderState {
  id: string;
  name: string;
  isActive: boolean;
}

export interface ProviderStatus {
  /** The provider, or null when none of this type has the id (also for a malformed id). */
  find(
    providerId: string,
    session?: ClientSession,
  ): Promise<ProviderState | null>;
  /** The providers of this type among `providerIds`, in one query; unknown or malformed ids are absent. */
  findMany(providerIds: readonly string[]): Promise<ProviderState[]>;
  /**
   * Sets `isActive` only if it currently has the other value (one conditional update). Returns false,
   * changing nothing, when it already had that value or does not exist.
   */
  setActive(
    providerId: string,
    active: boolean,
    session: ClientSession,
  ): Promise<boolean>;
}

/* ----------------------------------------------------------------------------------------------
 * Itinerary budgets (ITN-14, ITN-16, Malak -> itineraries). The budgets module provides it under
 * ITINERARY_BUDGETS. Itineraries inject it with @Optional(): until it is provided, day subtotals
 * (ITN-09) count activity costs only, and deleting or cloning an itinerary (ITN-01, ITN-07, ITN-21)
 * has no budget rows to touch. Amounts stay in their own currency; conversion is ITN-18's job.
 * -------------------------------------------------------------------------------------------- */

export interface MoneyAmount {
  /** Uppercase ISO 4217 code. */
  currency: string;
  /** Integer minor units (ADR-0004). */
  amountMinor: number;
}

export interface ItineraryDayBudget {
  /** The embedded itinerary day's _id. */
  dayId: string;
  /** Budget entries and transport costs of that day, summed per currency. */
  amounts: MoneyAmount[];
}

export interface ItineraryBudgets {
  /** Per-day totals of budget entries and transport costs, for days that have any. */
  dayTotals(itineraryId: string): Promise<ItineraryDayBudget[]>;
  /** ITN-07: removes the budget rows of deleted days. */
  deleteForDays(itineraryId: string, dayIds: string[]): Promise<void>;
  /** ITN-01: removes every budget row of a deleted itinerary. */
  deleteForItinerary(itineraryId: string): Promise<void>;
  /**
   * ITN-21: copies every budget row of `sourceId` to `targetId`, mapping each source day id to the
   * clone's day id. Rows of days missing from the map are skipped.
   */
  cloneForItinerary(
    sourceId: string,
    targetId: string,
    dayIdMap: ReadonlyMap<string, string>,
  ): Promise<void>;
}

/* ----------------------------------------------------------------------------------------------
 * Public itineraries of an author (BLG-12, itineraries -> blog). The itineraries module provides it
 * under PUBLIC_ITINERARIES: only PUBLIC itineraries that an admin has not hidden (ITN-20, GEN-10), newest
 * update first, PAGE_SIZE per page (GEN-05). The blog never reads the itineraries collection itself.
 * -------------------------------------------------------------------------------------------- */

export interface PublicItinerarySummary {
  id: string;
  title: string;
  /** ISO 3166-1 alpha-2 codes. */
  countries: string[];
  /** Calendar date YYYY-MM-DD. */
  startDate: string;
  /** Number of days. */
  days: number;
}

export interface PublicItineraries {
  /** One page of the author's public itineraries and how many there are in all. */
  ofAuthor(
    authorId: string,
    page: number,
  ): Promise<{ items: PublicItinerarySummary[]; total: number }>;
}

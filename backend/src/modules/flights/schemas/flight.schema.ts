import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SCHEMA_OPTIONS, type CabinClass } from '../../../common/contracts';

/** FLT-30 lifecycle. Only SCHEDULED flights are searchable, editable or bookable. */
export enum FlightStatus {
  Scheduled = 'SCHEDULED',
  Cancelled = 'CANCELLED',
  Departed = 'DEPARTED',
}

/** The fixed cabin set of FLT-04, in display order (same values as the CabinClass contract type). */
export const CABIN_CLASSES: readonly CabinClass[] = [
  'ECONOMY',
  'PREMIUM_ECONOMY',
  'BUSINESS',
  'FIRST',
];

const integer = (name: string) => ({
  validator: Number.isSafeInteger,
  message: `${name} must be a whole number`,
});

/**
 * One cabin category of a flight (FLT-04), embedded because it is bounded and owned by the flight
 * (ERD: "cabins in a flight"). Keeps its own _id for PATCH /api/flights/:id/cabins/:cabinId.
 *
 * Inventory (ADR-0002): `seatsAvailable` = totalSeats - booked - held. Seat holds (FLT-22) take seats
 * with one conditional atomic update, { 'cabins.$.seatsAvailable': { $gte: n } } + $inc -n, and
 * expiry or cancellation gives them back with $inc +n. Seats booked or held are therefore
 * `totalSeats - seatsAvailable`, which FLT-05 uses as the floor when a moderator lowers totalSeats.
 */
@Schema({ _id: true })
export class Cabin {
  _id!: Types.ObjectId;

  @Prop({ type: String, enum: CABIN_CLASSES, required: true })
  class!: CabinClass;

  /** Whole number > 0 (FLT-04). */
  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: integer('totalSeats'),
  })
  totalSeats!: number;

  /** Seats neither booked nor held; never negative and never above totalSeats. */
  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: [
      integer('seatsAvailable'),
      {
        // On a document save `this` is the cabin, so the bound is checked. In update validators
        // (runValidators) `this` is the query and has no totalSeats, so this check is skipped:
        // updates change seatsAvailable only with $inc, which update validators never run on, and
        // the conditional filter (ADR-0002) keeps it between 0 and totalSeats.
        validator: function (this: Cabin, value: number) {
          return (
            typeof this.totalSeats !== 'number' || value <= this.totalSeats
          );
        },
        message: 'seatsAvailable cannot exceed totalSeats',
      },
    ],
  })
  seatsAvailable!: number;

  /** Fare per seat, > 0, integer minor units of PLATFORM_CURRENCY (PAY-04). */
  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: integer('priceMinor'),
  })
  priceMinor!: number;

  /** Free checked bags per passenger (FLT-04). */
  @Prop({ type: Number, required: true, min: 0, validate: integer('freeBags') })
  freeBags!: number;

  /** Maximum kg per bag; extra bags share the same limit (FLT-08). */
  @Prop({ type: Number, required: true, min: 1, max: 100 })
  maxKgPerBag!: number;
}
export const CabinSchema = SchemaFactory.createForClass(Cabin);

/**
 * flights (TRVL-138, docs/architecture/erd.md). Times are UTC instants; they are entered and shown in
 * each airport's IANA zone through common/utils/dates (FLT-03, GEN-06). `from`/`to` are IATA codes of
 * the seeded airports (FLT-02), validated against REFERENCE_SERVICE when a flight is created.
 */
@Schema({ ...SCHEMA_OPTIONS, collection: 'flights' })
export class Flight {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  airlineId!: Types.ObjectId;

  /** e.g. MS777: unique per airline and local departure date (FLT-03). */
  @Prop({
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    match: /^[A-Z0-9]{2,8}$/,
  })
  flightNumber!: string;

  @Prop({ type: String, required: true, match: /^[A-Z]{3}$/ })
  from!: string;

  @Prop({
    type: String,
    required: true,
    match: /^[A-Z]{3}$/,
    validate: {
      validator: function (this: Flight, value: string) {
        return value !== this.from;
      },
      message: 'Departure and arrival airports must differ',
    },
  })
  to!: string;

  @Prop({ type: Date, required: true })
  departureUtc!: Date;

  @Prop({
    type: Date,
    required: true,
    validate: {
      validator: function (this: Flight, value: Date) {
        return (
          !(this.departureUtc instanceof Date) || value > this.departureUtc
        );
      },
      message: 'Arrival must be after departure',
    },
  })
  arrivalUtc!: Date;

  /**
   * YYYY-MM-DD calendar date of departure at the origin airport. Not in the first ERD draft: it backs
   * the FLT-03 rule "no duplicate flight number for the same airline on the same departure date" with
   * a unique index, and the FLT-11 "departure date (local date at the departure airport)" search.
   */
  @Prop({ type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  departureLocalDate!: string;

  @Prop({
    type: String,
    enum: Object.values(FlightStatus),
    default: FlightStatus.Scheduled,
  })
  status!: FlightStatus;

  @Prop({
    type: [CabinSchema],
    default: [],
    validate: {
      validator: (cabins: Cabin[]) =>
        new Set(cabins.map((c) => c.class)).size === cabins.length,
      message: 'Each cabin class can be used at most once per flight',
    },
  })
  cabins!: Types.DocumentArray<Cabin>;

  createdAt!: Date;
  updatedAt!: Date;
}

export type FlightDocument = HydratedDocument<Flight>;
export const FlightSchema = SchemaFactory.createForClass(Flight);

// FLT-03: one flight number per airline per local departure date.
FlightSchema.index(
  { airlineId: 1, flightNumber: 1, departureLocalDate: 1 },
  { unique: true, name: 'uniq_airline_flight_number_local_date' },
);
// FLT-11 search: equality fields first, then the departure-time range.
FlightSchema.index(
  { from: 1, to: 1, status: 1, departureUtc: 1 },
  { name: 'search_route_status_departure' },
);
// FLT-30 job: find Scheduled flights whose departure has passed.
FlightSchema.index(
  { status: 1, departureUtc: 1 },
  { name: 'status_departure' },
);

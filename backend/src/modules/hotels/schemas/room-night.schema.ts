import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SCHEMA_OPTIONS } from '../../../common/contracts';
import { isoDate } from './iso-date';

export const ROOM_NIGHTS_COLLECTION = 'room_nights';

export enum RoomNightState {
  /** Blocked by the hotel moderator (HTL-06); no reservation. */
  Blocked = 'BLOCKED',
  /** Part of a Pending Payment reservation's 10-minute hold (HTL-18). */
  Held = 'HELD',
  /** Part of a Confirmed reservation (HTL-17). */
  Booked = 'BOOKED',
}

/**
 * room_nights (TRVL-140, ADR-0002): one document per room per night that is held, booked or blocked.
 * A hold inserts one per room per night inside a transaction; the unique {roomId, date} index makes the
 * database refuse any overlap with another hold, booking or block, so nothing is ever double booked.
 * Free nights have no document. Expired holds and cancellations delete their nights.
 */
@Schema({ ...SCHEMA_OPTIONS, collection: ROOM_NIGHTS_COLLECTION })
export class RoomNight {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Room', required: true })
  roomId!: Types.ObjectId;

  /** Denormalised for the moderator's room status view (HTL-08). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hotel', required: true })
  hotelId!: Types.ObjectId;

  /** The night, as the hotel-local date of its evening (check-in day .. day before check-out). */
  @Prop({ type: String, required: true, validate: isoDate('date') })
  date!: string;

  @Prop({ type: String, required: true, enum: Object.values(RoomNightState) })
  state!: RoomNightState;

  /** The reservation holding or booking this night; null exactly when BLOCKED (checked on validate). */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'HotelReservation',
    default: null,
  })
  reservationId!: Types.ObjectId | null;

  /**
   * The reservation reference, set exactly when BOOKED (HTL-08 shows it). Updates skip document
   * validation, so the confirm step must flip with a guarded filter, e.g.
   * `updateMany({ reservationId, state: HELD }, { $set: { state: BOOKED, reference } })` with a
   * non-empty reference.
   */
  @Prop({ type: String, default: null })
  reference!: string | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type RoomNightDocument = HydratedDocument<RoomNight>;
export const RoomNightSchema = SchemaFactory.createForClass(RoomNight);
// State, reservation and reference must agree. A document hook, because `this` in a path validator is
// the Query during updates and would not see `state`.
RoomNightSchema.pre('validate', function (this: RoomNightDocument) {
  const blocked = this.state === RoomNightState.Blocked;
  if (blocked !== (this.reservationId == null)) {
    this.invalidate(
      'reservationId',
      'reservationId is required for HELD and BOOKED nights only',
    );
  }
  const booked = this.state === RoomNightState.Booked;
  if (
    booked !== (typeof this.reference === 'string' && this.reference !== '')
  ) {
    this.invalidate(
      'reference',
      'reference is required for BOOKED nights only',
    );
  }
});
// A room is held, booked or blocked at most once per night: the database refuses double booking.
RoomNightSchema.index(
  { roomId: 1, date: 1 },
  { unique: true, name: 'one_state_per_room_night' },
);
// Release or confirm all nights of a reservation.
RoomNightSchema.index({ reservationId: 1 });
// HTL-08 and search (HTL-11): taken nights of a hotel in a date range.
RoomNightSchema.index({ hotelId: 1, date: 1 });

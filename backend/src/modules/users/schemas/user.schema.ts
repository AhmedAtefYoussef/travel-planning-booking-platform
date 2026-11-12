import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  MODERATOR_PROVIDER,
  ProviderType,
  Role,
} from '../../../common/auth/auth.types';
import { SCHEMA_OPTIONS } from '../../../common/contracts';
import { safeInteger } from '../../../common/validation';

export const USERS_COLLECTION = 'users';

/**
 * Account status (ACC-04, ACC-12, ACC-15, ACC-16). Only ACTIVE accounts can log in.
 *   SUSPENDED   set by an admin; reactivated by an admin
 *   DEACTIVATED set by the user themself (ACC-12)
 */
export enum AccountStatus {
  Active = 'ACTIVE',
  Suspended = 'SUSPENDED',
  Deactivated = 'DEACTIVATED',
}

/** The one airline or hotel a moderator manages (brief section 4, ACC-13). */
@Schema({ _id: false })
export class AssignedProviderDoc {
  @Prop({ type: String, enum: Object.values(ProviderType), required: true })
  type!: ProviderType;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  providerId!: Types.ObjectId;
}
const AssignedProviderSchema =
  SchemaFactory.createForClass(AssignedProviderDoc);

/**
 * users (TRVL-137). Emails are stored lowercased and trimmed, so the unique index makes
 * "A@x.com" and "a@x.com" the same account (ACC-01). The password hash is never selected or
 * serialised unless a query asks for it with `.select('+passwordHash')` (login, change password).
 */
@Schema({
  ...SCHEMA_OPTIONS,
  collection: USERS_COLLECTION,
  toJSON: {
    ...SCHEMA_OPTIONS.toJSON,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      delete ret._id;
      delete ret.passwordHash;
      return ret;
    },
  },
})
export class User {
  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  name!: string;

  @Prop({
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: 254,
  })
  email!: string;

  @Prop({ type: String, required: true, select: false })
  passwordHash!: string;

  @Prop({ type: String, trim: true, maxlength: 20 })
  phone?: string;

  /** ISO 4217 code shown in budgets (ACC-09, ITN-18); unset means PLATFORM_CURRENCY. */
  @Prop({ type: String, uppercase: true, match: /^[A-Z]{3}$/ })
  preferredCurrency?: string;

  /** When the guest ticked the terms-and-privacy box (ACC-01). Unset for seeded admins and moderators. */
  @Prop({ type: Date })
  termsAcceptedAt?: Date;

  @Prop({
    type: String,
    enum: Object.values(Role),
    required: true,
    default: Role.User,
    index: true,
  })
  role!: Role;

  @Prop({
    type: String,
    enum: Object.values(AccountStatus),
    required: true,
    default: AccountStatus.Active,
    index: true,
  })
  status!: AccountStatus;

  /** Set by an admin reset (ACC-07a) or a new moderator (ACC-13); cleared by the next password change. */
  @Prop({ type: Boolean, default: false })
  mustChangePassword!: boolean;

  /** Consecutive failed logins; reset by a successful login (ACC-05). */
  @Prop({
    type: Number,
    default: 0,
    min: 0,
    validate: safeInteger('failedLoginCount'),
  })
  failedLoginCount!: number;

  /** When the last login attempt was counted; attempts older than this window are stale (ACC-05). */
  @Prop({ type: Date })
  lastLoginAttemptAt?: Date;

  /** Login is refused until this instant (ACC-05). */
  @Prop({ type: Date })
  lockedUntil?: Date;

  /** Required for moderators, forbidden for everyone else (see the validator below). */
  @Prop({ type: AssignedProviderSchema, default: undefined })
  assignedProvider?: AssignedProviderDoc;

  createdAt!: Date;
  updatedAt!: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);

// ACC-14: admin list sorted by registration date, newest first.
UserSchema.index({ createdAt: -1 });

/**
 * A moderator is linked to exactly one provider of the matching type (ACC-13), and only moderators
 * have one. Enforced on save, so no service can create a hotel moderator without a hotel.
 */
UserSchema.pre('validate', function () {
  const expected = MODERATOR_PROVIDER[this.role];
  const assigned = this.assignedProvider;
  if (expected && assigned?.type !== expected) {
    this.invalidate(
      'assignedProvider',
      `A ${this.role} must be assigned to exactly one ${expected.toLowerCase()}`,
    );
  } else if (!expected && assigned) {
    this.invalidate(
      'assignedProvider',
      `Only moderators can be assigned to a provider`,
    );
  }
});

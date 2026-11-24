import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  ModeratableContentType,
  SCHEMA_OPTIONS,
} from '../../../common/contracts';

export const REPORTS_COLLECTION = 'reports';
export const REPORT_REASON_MAX = 500;

/** OPEN until an admin resolves it (GEN-10): dismissed, or the content hidden or deleted. */
export enum ReportStatus {
  Open = 'OPEN',
  Dismissed = 'DISMISSED',
  Hidden = 'HIDDEN',
  Deleted = 'DELETED',
}

/** reports (GEN-09): one user's report of one post, comment, review or itinerary. */
@Schema({ ...SCHEMA_OPTIONS, collection: REPORTS_COLLECTION })
export class Report {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  reporterId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(ModeratableContentType),
    required: true,
  })
  targetType!: ModeratableContentType;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  targetId!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: REPORT_REASON_MAX,
  })
  reason!: string;

  @Prop({
    type: String,
    enum: Object.values(ReportStatus),
    required: true,
    default: ReportStatus.Open,
  })
  status!: ReportStatus;

  /** GEN-10: the admin who resolved it, when and why. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  resolvedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  resolvedAt!: Date | null;

  @Prop({ type: String, trim: true, maxlength: REPORT_REASON_MAX })
  resolutionNote?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ReportDocument = HydratedDocument<Report>;
export const ReportSchema = SchemaFactory.createForClass(Report);

/**
 * GEN-09 "at most once per item": also stops two simultaneous reports (E11000 -> 409). It keeps
 * MongoDB's default name (reporterId_1_targetType_1_targetId_1): the shared database already has this
 * index under that name, and a second name for the same index makes startup fail with error 85.
 */
ReportSchema.index(
  { reporterId: 1, targetType: 1, targetId: 1 },
  { unique: true },
);
/** GEN-10 admin queue: open reports, oldest or newest first. */
ReportSchema.index({ status: 1, createdAt: -1 });
/** GEN-10: resolving one item resolves every report of it. */
ReportSchema.index({ targetType: 1, targetId: 1 });

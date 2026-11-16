import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ModeratableContentType } from '../../../common/contracts';
import { ReportAction, ReportStatus } from '../report.enums';

export { ReportAction, ReportStatus };

export const REPORTS_COLLECTION = 'reports';
export const REPORT_REASON_MAX = 500;

@Schema({ _id: false })
export class ReportResolution {
  @Prop({ type: String, enum: Object.values(ReportAction), required: true })
  action!: ReportAction;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  adminId!: Types.ObjectId;

  @Prop({ type: Date, required: true })
  at!: Date;
}
const ReportResolutionSchema = SchemaFactory.createForClass(ReportResolution);

/**
 * reports (GEN-09, GEN-10): a registered user's report of a post, comment, review or itinerary.
 * One per user per item (unique index). An admin resolves it: DISMISSED, or ACTIONED when the content
 * is hidden or deleted.
 */
@Schema({ collection: REPORTS_COLLECTION, timestamps: true })
export class Report {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
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
    default: ReportStatus.Open,
  })
  status!: ReportStatus;

  @Prop({ type: ReportResolutionSchema, default: null })
  resolution!: ReportResolution | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ReportDocument = HydratedDocument<Report>;
export const ReportSchema = SchemaFactory.createForClass(Report);

// GEN-09: at most one report per user per item.
ReportSchema.index(
  { reporterId: 1, targetType: 1, targetId: 1 },
  { unique: true },
);
// GEN-10: the admin list of open reports, newest first.
ReportSchema.index({ status: 1, createdAt: -1 });
// Resolving every open report on one item when it is hidden or deleted.
ReportSchema.index({ targetType: 1, targetId: 1, status: 1 });

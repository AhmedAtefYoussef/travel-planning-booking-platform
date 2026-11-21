import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Throwaway collection used only by the dev-only duplicate-key demo (TRVL-130: duplicate key -> 409). */
@Schema({ collection: 'diagnostic_records', timestamps: true })
export class DiagnosticRecord {
  @Prop({ type: String, required: true, unique: true })
  key!: string;
}

export type DiagnosticRecordDocument = HydratedDocument<DiagnosticRecord>;
export const DiagnosticRecordSchema =
  SchemaFactory.createForClass(DiagnosticRecord);
// Demo data never needs to outlive a review session.
DiagnosticRecordSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 24 * 60 * 60 },
);

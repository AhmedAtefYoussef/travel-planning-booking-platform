import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Append-only: the schema blocks every update/delete operation. */
@Schema({
  collection: 'audit_logs',
  timestamps: { createdAt: true, updatedAt: false },
  versionKey: false,
})
export class AuditLog {
  @Prop({ type: String, default: null, index: true })
  actorId: string | null;

  @Prop({ required: true, index: true })
  action: string;

  @Prop({ required: true })
  targetType: string;

  @Prop({ required: true })
  targetId: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;

  createdAt: Date;
}

export type AuditLogDocument = HydratedDocument<AuditLog>;
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ createdAt: -1 });

const BLOCKED = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
] as const;

for (const op of BLOCKED) {
  AuditLogSchema.pre(op as any, function () {
    throw new Error('Audit log entries are immutable');
  });
}
AuditLogSchema.pre('save', function () {
  if (!this.isNew) throw new Error('Audit log entries are immutable');
});

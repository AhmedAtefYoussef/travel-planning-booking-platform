import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Role } from '../../../common/auth/auth.types';
import { AuditAction, AuditTargetType } from '../../../common/contracts';

/**
 * audit_logs (TRVL-162, GEN-07): one append-only entry per important admin action.
 * There is no update or delete path; reads go through GET /api/admin/audit-logs (paginated).
 */
@Schema({
  collection: 'audit_logs',
  timestamps: { createdAt: true, updatedAt: false },
})
export class AuditLog {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  actorId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(Role), required: true })
  actorRole!: Role;

  @Prop({ type: String, enum: Object.values(AuditAction), required: true })
  action!: AuditAction;

  @Prop({ type: String, enum: Object.values(AuditTargetType), required: true })
  targetType!: AuditTargetType;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  targetId!: Types.ObjectId;

  @Prop({ type: String, maxlength: 500 })
  reason?: string;

  @Prop({ type: Object, default: undefined })
  metadata?: Record<string, unknown>;

  createdAt!: Date;
}

export type AuditLogDocument = HydratedDocument<AuditLog>;
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ actorId: 1, createdAt: -1 });
AuditLogSchema.index({ targetType: 1, targetId: 1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });

// Append-only: refuse every update path at the model level, not just in controllers.
const blockMutation = function (): never {
  throw new Error('audit_logs is append-only');
};
for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findOneAndReplace',
] as const) {
  AuditLogSchema.pre(op, blockMutation);
}
// Document-level: saving an already-persisted entry would overwrite it.
AuditLogSchema.pre('save', function () {
  if (!this.isNew) blockMutation();
});
// Model.bulkWrite bypasses query middleware; allow only inserts through it.
AuditLogSchema.pre(
  'bulkWrite',
  function (next: (err?: Error) => void, ops: Array<Record<string, unknown>>) {
    if (ops.some((op) => !('insertOne' in op))) {
      next(new Error('audit_logs is append-only'));
      return;
    }
    next();
  },
);

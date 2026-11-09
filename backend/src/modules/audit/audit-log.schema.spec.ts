import { model, Types } from 'mongoose';
import { AuditLogSchema } from './audit-log.schema';

/**
 * GEN-07: the schema hooks reject every update/delete path. The hooks throw
 * before any driver call, so no database connection is needed.
 */
describe('AuditLogSchema immutability hooks', () => {
  const AuditLog = model('AuditLogHookTest', AuditLogSchema);
  const id = new Types.ObjectId();
  const patch = { action: 'X' };

  const queries: [string, () => Promise<unknown>][] = [
    ['updateOne', () => AuditLog.updateOne({ _id: id }, patch).exec()],
    ['updateMany', () => AuditLog.updateMany({}, patch).exec()],
    [
      'findOneAndUpdate',
      () => AuditLog.findOneAndUpdate({ _id: id }, patch).exec(),
    ],
    [
      'findOneAndReplace',
      () => AuditLog.findOneAndReplace({ _id: id }, patch).exec(),
    ],
    ['replaceOne', () => AuditLog.replaceOne({ _id: id }, patch).exec()],
    ['deleteOne', () => AuditLog.deleteOne({ _id: id }).exec()],
    ['deleteMany', () => AuditLog.deleteMany({}).exec()],
    ['findOneAndDelete', () => AuditLog.findOneAndDelete({ _id: id }).exec()],
  ];

  it.each(queries)('%s is rejected', async (_name, run) => {
    await expect(run()).rejects.toThrow('Audit log entries are immutable');
  });

  it('re-saving an existing entry is rejected', async () => {
    const doc = new AuditLog({ action: 'A', targetType: 'T', targetId: '1' });
    doc.isNew = false;
    await expect(doc.save()).rejects.toThrow('Audit log entries are immutable');
  });
});

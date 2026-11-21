import { Types } from 'mongoose';
import { Role } from '../../common/auth/auth.types';
import { AuditAction, AuditTargetType } from '../../common/contracts';
import { AuditLogService, sanitizeMetadata } from './audit-log.service';

describe('sanitizeMetadata (audit entries never store secrets)', () => {
  it('drops secret-looking keys at any depth and keeps the rest', () => {
    expect(
      sanitizeMetadata({
        before: { status: 'ACTIVE', passwordHash: 'x' },
        after: { status: 'SUSPENDED' },
        token: 't',
        cardNumber: '4242',
        list: [{ secret: 's', ok: true }],
      }),
    ).toEqual({
      before: { status: 'ACTIVE' },
      after: { status: 'SUSPENDED' },
      list: [{ ok: true }],
    });
  });

  it('passes primitives through and truncates anything too deep to check', () => {
    expect(sanitizeMetadata('x')).toBe('x');
    expect(sanitizeMetadata(null)).toBeNull();
    const deep = {
      a: { b: { c: { d: { e: { password: 'never-stored' } } } } },
    };
    expect(sanitizeMetadata(deep)).toEqual({
      a: { b: { c: { d: { e: '[truncated]' } } } },
    });
  });
});

describe('AuditLogService.list (GEN-07)', () => {
  const actorId = new Types.ObjectId();
  const row = {
    _id: new Types.ObjectId(),
    actorId,
    actorRole: Role.Admin,
    action: AuditAction.SuspendAccount,
    targetType: AuditTargetType.User,
    targetId: new Types.ObjectId(),
    createdAt: new Date('2026-11-16T10:00:00Z'),
  };
  const fakeModel = () => {
    const find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([row]),
    });
    const countDocuments = jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(1) });
    return { find, countDocuments };
  };

  it('builds one combined filter and maps rows to the DTO without absent optionals', async () => {
    const model = fakeModel();
    const service = new AuditLogService(model as never);
    const result = await service.list({
      page: 1,
      action: AuditAction.SuspendAccount,
      targetType: AuditTargetType.User,
      actorId: actorId.toHexString(),
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(model.find.mock.calls[0][0]).toEqual({
      action: 'SUSPEND_ACCOUNT',
      targetType: 'USER',
      actorId,
      createdAt: {
        $gte: new Date('2026-11-01'),
        $lt: new Date('2026-12-01'),
      },
    });
    expect(result.items[0]).toEqual({
      id: row._id.toHexString(),
      action: 'SUSPEND_ACCOUNT',
      actor: { id: actorId.toHexString(), role: Role.Admin },
      targetType: 'USER',
      targetId: row.targetId.toHexString(),
      createdAt: row.createdAt,
    });
    expect(result).toMatchObject({ total: 1, limit: 10, page: 1 });
  });

  it('a date-time to stays inclusive ($lte)', async () => {
    const model = fakeModel();
    await new AuditLogService(model as never).list({
      page: 1,
      to: '2026-11-30T10:00:00+02:00',
    });
    expect(model.find.mock.calls[0][0]).toEqual({
      createdAt: { $lte: new Date('2026-11-30T08:00:00Z') },
    });
  });

  it('strips secret-looking keys from metadata of older rows when reading', async () => {
    const model = fakeModel();
    model.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest
        .fn()
        .mockResolvedValue([
          { ...row, metadata: { role: 'USER', passwordHash: 'x', token: 't' } },
        ]),
    });
    const result = await new AuditLogService(model as never).list({ page: 1 });
    expect(result.items[0].metadata).toEqual({ role: 'USER' });
  });

  it('applies no filter when none is given', async () => {
    const model = fakeModel();
    await new AuditLogService(model as never).list({ page: 1 });
    expect(model.find.mock.calls[0][0]).toEqual({});
  });
});

import { Types, type Model } from 'mongoose';
import { Role } from '../../common/auth/auth.types';
import { AuditAction, AuditTargetType } from '../../common/contracts';
import { ValidationFailedException } from '../../common/errors/app.exception';
import {
  auditDateRange,
  AuditLogService,
  sanitizeMetadata,
} from './audit-log.service';
import { isAuditInstant } from './dto/audit-log.dto';
import type { AuditLog } from './schemas/audit-log.schema';

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

describe('auditDateRange (GEN-07 filters)', () => {
  it('a date alone covers the whole UTC day', () => {
    expect(auditDateRange('2026-11-01', '2026-11-30')).toEqual({
      $gte: new Date('2026-11-01T00:00:00.000Z'),
      $lt: new Date('2026-12-01T00:00:00.000Z'),
    });
  });

  it('a date and time is used as given, inclusive', () => {
    expect(
      auditDateRange('2026-11-10T08:00:00+02:00', '2026-11-10T09:30:00Z'),
    ).toEqual({
      $gte: new Date('2026-11-10T06:00:00.000Z'),
      $lte: new Date('2026-11-10T09:30:00.000Z'),
    });
  });

  it('accepts one bound alone, the same day on both sides, and no bound', () => {
    expect(auditDateRange('2026-11-10')).toEqual({
      $gte: new Date('2026-11-10T00:00:00.000Z'),
    });
    expect(auditDateRange(undefined, '2026-11-10')).toEqual({
      $lt: new Date('2026-11-11T00:00:00.000Z'),
    });
    expect(auditDateRange('2026-11-10', '2026-11-10')).toBeDefined();
    expect(
      auditDateRange('2026-11-10T09:00:00Z', '2026-11-10T09:00:00Z'),
    ).toBeDefined();
    expect(auditDateRange()).toBeUndefined();
  });

  it('rejects a range that ends before it starts with a field error on `to`', () => {
    for (const [from, to] of [
      ['2026-11-11', '2026-11-10'],
      ['2026-11-10T09:00:01Z', '2026-11-10T09:00:00Z'],
      ['2026-11-11T00:00:00Z', '2026-11-10'],
    ]) {
      expect(() => auditDateRange(from, to)).toThrow(ValidationFailedException);
    }
  });
});

describe('isAuditInstant', () => {
  it.each([
    '2026-11-10',
    '2026-11-10T08:30Z',
    '2026-11-10T08:30:00Z',
    '2026-11-10T08:30:00.123+02:00',
  ])('accepts %s', (value) => {
    expect(isAuditInstant(value)).toBe(true);
  });

  it.each([
    '2026-02-30',
    '2026-13-01',
    '2026-11-10T08:30:00',
    '2026-11-10T24:00:00Z',
    '2026-11-10T08:60:00Z',
    '10/11/2026',
    'yesterday',
    '',
    20261110,
  ])('rejects %s', (value) => {
    expect(isAuditInstant(value)).toBe(false);
  });
});

describe('AuditLogService.list (GEN-07)', () => {
  const actorId = new Types.ObjectId();
  const targetId = new Types.ObjectId();
  const stored = {
    _id: new Types.ObjectId(),
    actorId,
    actorRole: Role.Admin,
    action: AuditAction.SuspendAccount,
    targetType: AuditTargetType.User,
    targetId,
    reason: 'Spam',
    createdAt: new Date('2026-11-10T09:00:00Z'),
  };

  function setup() {
    const find = jest.fn(() => ({
      sort: () => ({
        skip: () => ({
          limit: () => ({
            lean: () => ({ exec: () => Promise.resolve([stored]) }),
          }),
        }),
      }),
    }));
    const countDocuments = jest.fn(() => ({ exec: () => Promise.resolve(1) }));
    const service = new AuditLogService({
      find,
      countDocuments,
    } as unknown as Model<AuditLog>);
    return { service, find, countDocuments };
  }

  it('combines every filter with AND and maps entries for admins', async () => {
    const { service, find } = setup();
    const page = await service.list({
      page: 1,
      action: AuditAction.SuspendAccount,
      targetType: AuditTargetType.User,
      targetId: targetId.toHexString(),
      actorId: actorId.toHexString(),
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(find).toHaveBeenCalledWith(
      {
        action: 'SUSPEND_ACCOUNT',
        targetType: 'USER',
        targetId,
        actorId,
        createdAt: {
          $gte: new Date('2026-11-01T00:00:00.000Z'),
          $lt: new Date('2026-12-01T00:00:00.000Z'),
        },
      },
      undefined,
    );
    expect(page).toEqual({
      items: [
        {
          id: stored._id.toHexString(),
          actorId: actorId.toHexString(),
          actorRole: 'ADMIN',
          action: 'SUSPEND_ACCOUNT',
          targetType: 'USER',
          targetId: targetId.toHexString(),
          reason: 'Spam',
          metadata: null,
          createdAt: stored.createdAt,
        },
      ],
      page: 1,
      limit: 10,
      total: 1,
      totalPages: 1,
    });
  });

  it('lists everything when no filter is given', async () => {
    const { service, find } = setup();
    await service.list({ page: 1 });
    expect(find).toHaveBeenCalledWith({}, undefined);
  });
});

import { Types } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import {
  AuditAction,
  ModeratableContentType,
  type AuditService,
  type ModeratableContent,
  type ModeratableContentAdapter,
} from '../../common/contracts';
import { AdminModerationService } from './admin-moderation.service';
import { ContentModerationRegistry } from './content-moderation.registry';
import { ReportAction } from './dto/admin-moderation.dto';
import { ReportStatus } from './schemas/report.schema';

const ADMIN: AuthUser = { id: 'a'.repeat(24), role: Role.Admin };
const AUTHOR = 'b'.repeat(24);
const TARGET = 'c'.repeat(24);
const REPORT_ID = 'd'.repeat(24);
const SESSION = { id: 'session' };

type Failure = { getStatus(): number; code?: string };
const failure = (p: Promise<unknown>) =>
  p.catch((e: unknown) => e) as Promise<Failure>;

function adapter(
  content: Partial<ModeratableContent> | null,
  type = ModeratableContentType.Itinerary,
): jest.Mocked<ModeratableContentAdapter> {
  return {
    type,
    find: jest.fn().mockResolvedValue(
      content && {
        id: TARGET,
        authorId: AUTHOR,
        isHidden: false,
        isPublic: true,
        ...content,
      },
    ),
    setHidden: jest.fn().mockResolvedValue(true),
    remove: jest.fn().mockResolvedValue({
      afterCommit: jest.fn().mockResolvedValue(undefined),
    }),
  };
}

const exec = <T>(value: T) => ({
  lean: () => ({ exec: () => Promise.resolve(value) }),
  session: () => ({ exec: () => Promise.resolve(value) }),
  exec: () => Promise.resolve(value),
});

function setup(
  a: ModeratableContentAdapter | null,
  open: boolean | 'missing' = true,
) {
  const registry = new ContentModerationRegistry();
  if (a) registry.register(a);
  const stored = {
    _id: new Types.ObjectId(REPORT_ID),
    reporterId: new Types.ObjectId(),
    targetType: a?.type ?? ModeratableContentType.Itinerary,
    targetId: new Types.ObjectId(TARGET),
    reason: 'Spam',
    createdAt: new Date('2026-11-18T10:00:00Z'),
  };
  const sibling = new Types.ObjectId();
  const reports = {
    findOneAndUpdate: jest.fn(
      (_filter: unknown, update: { $set: Record<string, unknown> }) =>
        exec(open === true ? { ...stored, ...update.$set } : null),
    ),
    exists: jest.fn(() => exec(open === false ? { _id: stored._id } : null)),
    find: jest.fn(() => exec([{ _id: sibling }])),
    updateMany: jest.fn(() => exec({ modifiedCount: 1 })),
  };
  const events: string[] = [];
  const connection = {
    transaction: jest.fn(async (fn: (s: unknown) => Promise<unknown>) => {
      const result = await fn(SESSION);
      events.push('commit');
      return result;
    }),
  };
  const audit: jest.Mocked<AuditService> = {
    record: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AdminModerationService(
    connection as never,
    reports as never,
    registry,
    audit,
  );
  return { service, reports, audit, connection, events, sibling };
}

describe('AdminModerationService: GEN-10 resolve reports', () => {
  it('GEN-10 DISMISS closes only that report and audits RESOLVE_REPORT (GEN-07)', async () => {
    const a = adapter({});
    const { service, reports, audit } = setup(a);

    const res = await service.resolve(ADMIN, REPORT_ID, {
      action: ReportAction.Dismiss,
      note: 'Not spam',
    });

    expect(res).toMatchObject({
      id: REPORT_ID,
      status: ReportStatus.Dismissed,
      resolvedBy: ADMIN.id,
      resolutionNote: 'Not spam',
      otherReportsResolved: 0,
    });
    expect(a.setHidden).not.toHaveBeenCalled();
    expect(a.remove).not.toHaveBeenCalled();
    expect(reports.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.ResolveReport,
        targetType: 'REPORT',
        targetId: REPORT_ID,
        reason: 'Not spam',
        metadata: expect.objectContaining({ resolution: 'DISMISSED' }),
      }),
      SESSION,
    );
  });

  it('GEN-10 HIDE hides the content, closes sibling reports and audits both actions', async () => {
    const a = adapter({});
    const { service, reports, audit } = setup(a);

    const res = await service.resolve(ADMIN, REPORT_ID, {
      action: ReportAction.Hide,
    });

    expect(a.setHidden).toHaveBeenCalledWith(TARGET, true, SESSION);
    expect(res).toMatchObject({
      status: ReportStatus.Hidden,
      otherReportsResolved: 1,
    });
    expect(reports.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ status: ReportStatus.Open }),
      { $set: expect.objectContaining({ status: ReportStatus.Hidden }) },
      { session: SESSION },
    );
    expect(audit.record.mock.calls.map(([e]) => e.action)).toEqual([
      AuditAction.HideContent,
      AuditAction.ResolveReport,
    ]);
  });

  it('GEN-10 HIDE of already hidden content succeeds without a second HIDE_CONTENT entry', async () => {
    const a = adapter({ isHidden: true });
    a.setHidden.mockResolvedValue(false);
    const { service, audit } = setup(a);

    await expect(
      service.resolve(ADMIN, REPORT_ID, { action: ReportAction.Hide }),
    ).resolves.toMatchObject({ status: ReportStatus.Hidden });
    expect(audit.record.mock.calls.map(([e]) => e.action)).toEqual([
      AuditAction.ResolveReport,
    ]);
  });

  it('GEN-10 DELETE removes the content and runs afterCommit only after the commit', async () => {
    const a = adapter({});
    const { service, events } = setup(a);
    const afterCommit = jest.fn(() => {
      events.push('afterCommit');
      return Promise.resolve();
    });
    a.remove.mockResolvedValue({ afterCommit });

    await expect(
      service.resolve(ADMIN, REPORT_ID, { action: ReportAction.Delete }),
    ).resolves.toMatchObject({ status: ReportStatus.Deleted });
    expect(events).toEqual(['commit', 'afterCommit']);
  });

  it('GEN-10 a failing afterCommit is logged, never turned into an error', async () => {
    const a = adapter({});
    a.remove.mockResolvedValue({
      afterCommit: () => Promise.reject(new Error('disk gone')),
    });
    const { service } = setup(a);
    const log = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);

    await expect(
      service.resolve(ADMIN, REPORT_ID, { action: ReportAction.Delete }),
    ).resolves.toMatchObject({ status: ReportStatus.Deleted });
    expect(log).toHaveBeenCalled();
  });

  it.each([
    ['missing content', adapter(null)],
    ['an unregistered type', null],
  ])(
    'GEN-10 HIDE and DELETE answer 404 for %s',
    async (_, a: ModeratableContentAdapter | null) => {
      for (const action of [ReportAction.Hide, ReportAction.Delete]) {
        const { service, audit } = setup(a);
        const e = await failure(service.resolve(ADMIN, REPORT_ID, { action }));
        expect(e.getStatus()).toBe(404);
        expect(audit.record).not.toHaveBeenCalled();
      }
    },
  );

  it('GEN-10 DELETE answers 404 when the content vanished before remove()', async () => {
    const a = adapter({});
    a.remove.mockResolvedValue(null);
    const { service } = setup(a);
    const e = await failure(
      service.resolve(ADMIN, REPORT_ID, { action: ReportAction.Delete }),
    );
    expect(e.getStatus()).toBe(404);
  });

  it('GEN-10 an already resolved report is 409 REPORT_ALREADY_RESOLVED', async () => {
    const { service } = setup(adapter({}), false);
    const e = await failure(
      service.resolve(ADMIN, REPORT_ID, { action: ReportAction.Dismiss }),
    );
    expect(e.getStatus()).toBe(409);
    expect(e.code).toBe('REPORT_ALREADY_RESOLVED');
  });

  it('GEN-10 an unknown report is 404', async () => {
    const { service } = setup(adapter({}), 'missing');
    const e = await failure(
      service.resolve(ADMIN, REPORT_ID, { action: ReportAction.Dismiss }),
    );
    expect(e.getStatus()).toBe(404);
  });
});

describe('AdminModerationService: GEN-10 direct hide and delete', () => {
  it('GEN-10 hides content, closes its open reports as HIDDEN and audits HIDE_CONTENT', async () => {
    const a = adapter({});
    const { service, reports, audit } = setup(a);

    await expect(
      service.hide(ADMIN, ModeratableContentType.Itinerary, TARGET),
    ).resolves.toEqual({
      targetType: 'ITINERARY',
      targetId: TARGET,
      outcome: ReportStatus.Hidden,
      reportsResolved: 1,
    });
    expect(reports.updateMany).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.HideContent,
        targetType: 'ITINERARY',
        targetId: TARGET,
        metadata: { authorId: AUTHOR, reportsResolved: 1 },
      }),
      SESSION,
    );
  });

  it('GEN-10 hiding hidden content directly is 409 CONTENT_ALREADY_HIDDEN', async () => {
    const a = adapter({ isHidden: true });
    a.setHidden.mockResolvedValue(false);
    const { service, audit } = setup(a);
    const e = await failure(
      service.hide(ADMIN, ModeratableContentType.Itinerary, TARGET),
    );
    expect(e.getStatus()).toBe(409);
    expect(e.code).toBe('CONTENT_ALREADY_HIDDEN');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('GEN-10 deletes content, audits DELETE_CONTENT and runs afterCommit', async () => {
    const a = adapter({});
    const afterCommit = jest.fn().mockResolvedValue(undefined);
    a.remove.mockResolvedValue({ afterCommit });
    const { service, audit } = setup(a);

    await expect(
      service.remove(ADMIN, ModeratableContentType.Itinerary, TARGET),
    ).resolves.toMatchObject({ outcome: ReportStatus.Deleted });
    expect(afterCommit).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.DeleteContent,
        metadata: { authorId: AUTHOR, reportsResolved: 1 },
      }),
      SESSION,
    );
  });

  it('GEN-10 direct actions on missing content are 404', async () => {
    const { service } = setup(adapter(null));
    for (const p of [
      service.hide(ADMIN, ModeratableContentType.Itinerary, TARGET),
      service.remove(ADMIN, ModeratableContentType.Itinerary, TARGET),
      service.remove(ADMIN, ModeratableContentType.Review, TARGET),
    ]) {
      expect((await failure(p)).getStatus()).toBe(404);
    }
  });
});

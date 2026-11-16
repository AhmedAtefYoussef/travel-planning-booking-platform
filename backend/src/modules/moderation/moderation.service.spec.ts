import { Types, type Connection, type Model } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import {
  AuditAction,
  AuditTargetType,
  ModeratableContentType,
  type ModeratableContent,
} from '../../common/contracts';
import { ParseContentTypePipe } from './content-type.pipe';
import { ContentRegistryService } from './content-registry.service';
import { ModerationService } from './moderation.service';
import {
  ReportAction,
  ReportStatus,
  type Report,
} from './schemas/report.schema';

const ADMIN: AuthUser = {
  id: new Types.ObjectId().toHexString(),
  role: Role.Admin,
};
const SESSION = { id: 'tx' };
const lean = (value: unknown) => ({ lean: () => Promise.resolve(value) });

function setup(
  options: {
    report?: Partial<Report> | null;
    content?: ModeratableContent | null;
    registered?: boolean;
    raceLost?: boolean;
  } = {},
) {
  const reportId = new Types.ObjectId();
  const targetId = new Types.ObjectId();
  const stored =
    options.report === null
      ? null
      : {
          _id: reportId,
          reporterId: new Types.ObjectId(),
          targetType: ModeratableContentType.Post,
          targetId,
          reason: 'Spam',
          status: ReportStatus.Open,
          resolution: null,
          createdAt: new Date('2026-11-17T10:00:00Z'),
          ...options.report,
        };
  const reports = {
    findById: jest.fn().mockReturnValue({
      session: jest.fn().mockReturnValue(lean(stored)),
    }),
    findOneAndUpdate: jest.fn((_f: unknown, update: { $set: object }) =>
      lean(options.raceLost ? null : { ...stored, ...update.$set }),
    ),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 2 }),
  };
  const adapter = {
    type: ModeratableContentType.Post,
    find: jest
      .fn()
      .mockResolvedValue(
        options.content === undefined
          ? { ownerId: 'owner-1', hidden: false }
          : options.content,
      ),
    setHidden: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const registry = new ContentRegistryService();
  if (options.registered !== false) registry.register(adapter);
  const connection = {
    transaction: jest.fn((fn: (s: unknown) => Promise<unknown>) => fn(SESSION)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ModerationService(
    reports as unknown as Model<Report>,
    connection as unknown as Connection,
    registry,
    audit,
  );
  return {
    service,
    reports,
    adapter,
    audit,
    reportId: reportId.toHexString(),
    targetId: targetId.toHexString(),
  };
}

describe('ModerationService (GEN-10)', () => {
  describe('resolve', () => {
    it('DISMISS closes only the report and audits RESOLVE_REPORT', async () => {
      const { service, reportId, reports, adapter, audit } = setup();
      const dto = await service.resolve(ADMIN, reportId, ReportAction.Dismiss);
      expect(dto).toMatchObject({
        status: 'DISMISSED',
        resolution: { action: 'DISMISS', adminId: ADMIN.id },
      });
      expect(reports.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: ReportStatus.Open }),
        expect.anything(),
        expect.objectContaining({ session: SESSION }),
      );
      expect(adapter.find).not.toHaveBeenCalled();
      expect(reports.updateMany).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ResolveReport,
          targetType: AuditTargetType.Report,
          targetId: reportId,
          metadata: { action: ReportAction.Dismiss },
        }),
        SESSION,
      );
    });

    it('HIDE hides the content, closes open reports on it and audits both actions', async () => {
      const { service, reportId, targetId, reports, adapter, audit } = setup();
      const dto = await service.resolve(ADMIN, reportId, ReportAction.Hide);
      expect(dto.status).toBe('ACTIONED');
      expect(adapter.setHidden).toHaveBeenCalledWith(targetId, true, SESSION);
      expect(reports.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ status: ReportStatus.Open }),
        {
          $set: expect.objectContaining({ status: ReportStatus.Actioned }),
        },
        { session: SESSION },
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.HideContent,
          targetType: AuditTargetType.Post,
          targetId,
          metadata: { contentType: 'POST', ownerId: 'owner-1', reportId },
        }),
        SESSION,
      );
    });

    it('HIDE of content already hidden (reported by its author) only closes the reports', async () => {
      const { service, reportId, adapter, audit, reports } = setup({
        content: { ownerId: 'owner-1', hidden: true },
      });
      await service.resolve(ADMIN, reportId, ReportAction.Hide);
      expect(adapter.setHidden).not.toHaveBeenCalled();
      expect(reports.updateMany).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledTimes(1); // RESOLVE_REPORT only
    });

    it('DELETE removes the content and audits DELETE_CONTENT', async () => {
      const { service, reportId, targetId, adapter, audit } = setup();
      await service.resolve(ADMIN, reportId, ReportAction.Delete);
      expect(adapter.remove).toHaveBeenCalledWith(targetId, SESSION);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.DeleteContent }),
        SESSION,
      );
    });

    it('is 404 for an unknown report', async () => {
      const { service, reportId } = setup({ report: null });
      await expect(
        service.resolve(ADMIN, reportId, ReportAction.Dismiss),
      ).rejects.toMatchObject({ status: 404, message: 'Report not found' });
    });

    it('is 409 for a report that is not OPEN', async () => {
      const { service, reportId } = setup({
        report: { status: ReportStatus.Dismissed },
      });
      await expect(
        service.resolve(ADMIN, reportId, ReportAction.Hide),
      ).rejects.toMatchObject({
        status: 409,
        code: 'INVALID_STATE_TRANSITION',
      });
    });

    it('is 409 when another admin resolved it between the read and the update', async () => {
      const { service, reportId, audit } = setup({ raceLost: true });
      await expect(
        service.resolve(ADMIN, reportId, ReportAction.Dismiss),
      ).rejects.toMatchObject({ status: 409 });
      expect(audit.record).not.toHaveBeenCalled();
    });

    it.each([
      ['the content no longer exists', { content: null }],
      ['its module is no longer registered', { registered: false }],
    ])('HIDE is 409 when %s', async (_, options) => {
      const { service, reportId } = setup(options);
      await expect(
        service.resolve(ADMIN, reportId, ReportAction.Hide),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('act (direct hide or delete)', () => {
    it('hides an item and reports how many open reports it closed', async () => {
      const { service, targetId, adapter, audit } = setup();
      const result = await service.act(
        ADMIN,
        { type: ModeratableContentType.Post, id: targetId },
        ReportAction.Hide,
      );
      expect(result).toEqual({
        contentType: 'POST',
        contentId: targetId,
        action: 'HIDE',
        resolvedReports: 2,
      });
      expect(adapter.setHidden).toHaveBeenCalledWith(targetId, true, SESSION);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { contentType: 'POST', ownerId: 'owner-1' },
        }),
        SESSION,
      );
    });

    it('is 409 when the item is already hidden', async () => {
      const { service, targetId } = setup({
        content: { ownerId: 'owner-1', hidden: true },
      });
      await expect(
        service.act(
          ADMIN,
          { type: ModeratableContentType.Post, id: targetId },
          ReportAction.Hide,
        ),
      ).rejects.toMatchObject({
        status: 409,
        message: 'This content is already hidden',
      });
    });

    it.each([
      ['the item does not exist', { content: null }],
      ['the type is not registered', { registered: false }],
    ])('is 404 when %s', async (_, options) => {
      const { service, targetId } = setup(options);
      await expect(
        service.act(
          ADMIN,
          { type: ModeratableContentType.Post, id: targetId },
          ReportAction.Delete,
        ),
      ).rejects.toMatchObject({ status: 404, message: 'Content not found' });
    });
  });

  it('lists OPEN reports newest first, optionally one type', async () => {
    const { service, reports } = setup();
    const find = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    Object.assign(reports, {
      find: jest.fn().mockReturnValue(find),
      countDocuments: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }),
    });
    const page = await service.listOpen({
      page: 1,
      targetType: ModeratableContentType.Comment,
    });
    expect(page).toMatchObject({ items: [], total: 0, limit: 10 });
    expect(
      (reports as unknown as { find: jest.Mock }).find,
    ).toHaveBeenCalledWith(
      { status: ReportStatus.Open, targetType: 'COMMENT' },
      undefined,
    );
    expect(find.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
  });
});

describe('ParseContentTypePipe', () => {
  const pipe = new ParseContentTypePipe();
  it('accepts a content type in any letter case', () => {
    expect(pipe.transform('Post')).toBe(ModeratableContentType.Post);
    expect(pipe.transform('itinerary')).toBe(ModeratableContentType.Itinerary);
  });
  it.each(['blog', 'constructor', 42])('rejects %p with a 400 on type', (v) => {
    expect(() => pipe.transform(v)).toThrow(
      expect.objectContaining({
        fieldErrors: [expect.objectContaining({ field: 'type' })],
      }),
    );
  });
});

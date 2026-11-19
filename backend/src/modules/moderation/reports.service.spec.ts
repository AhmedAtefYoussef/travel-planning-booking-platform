import { Types } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import {
  ModeratableContentType,
  type ModeratableContent,
  type ModeratableContentAdapter,
} from '../../common/contracts';
import { ContentModerationRegistry } from './content-moderation.registry';
import { ReportsService } from './reports.service';
import { ReportStatus } from './schemas/report.schema';

const USER: AuthUser = { id: 'a'.repeat(24), role: Role.User };
const AUTHOR = 'b'.repeat(24);
const TARGET = 'c'.repeat(24);

function adapter(
  type: ModeratableContentType,
  content: Partial<ModeratableContent> | null,
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
    setHidden: jest.fn(),
    remove: jest.fn(),
  };
}

function setup(...adapters: ModeratableContentAdapter[]) {
  const registry = new ContentModerationRegistry();
  adapters.forEach((a) => registry.register(a));
  const reports = {
    create: jest.fn((doc: Record<string, unknown>) =>
      Promise.resolve({
        ...doc,
        _id: new Types.ObjectId(),
        status: ReportStatus.Open,
        createdAt: new Date('2026-11-18T10:00:00Z'),
      }),
    ),
  };
  const service = new ReportsService(reports as never, registry);
  return { service, reports };
}

const dto = (targetType = ModeratableContentType.Post) => ({
  targetType,
  targetId: TARGET,
  reason: 'Spam',
});

const failure = (p: Promise<unknown>) =>
  p.catch((e: unknown) => e) as Promise<{
    getStatus(): number;
    code?: string;
  }>;

describe('ReportsService: GEN-09 report content once per item', () => {
  it.each(Object.values(ModeratableContentType))(
    'files an OPEN report of a visible %s through its adapter',
    async (type) => {
      const a = adapter(type, {});
      const { service, reports } = setup(a);

      const report = await service.report(USER, dto(type));

      expect(a.find).toHaveBeenCalledWith(TARGET);
      expect(reports.create).toHaveBeenCalledWith(
        expect.objectContaining({ targetType: type, reason: 'Spam' }),
      );
      expect(report).toMatchObject({
        targetType: type,
        targetId: TARGET,
        reason: 'Spam',
        status: ReportStatus.Open,
      });
      expect(report.id).toMatch(/^[a-f0-9]{24}$/);
    },
  );

  it.each([
    ['an unknown id', null],
    ['hidden content of someone else', { isHidden: true }],
    ['private content of someone else', { isPublic: false }],
  ])('answers 404 for %s, filing nothing', async (_, content) => {
    const { service, reports } = setup(
      adapter(ModeratableContentType.Itinerary, content),
    );
    const e = await failure(
      service.report(USER, dto(ModeratableContentType.Itinerary)),
    );
    expect(e.getStatus()).toBe(404);
    expect(reports.create).not.toHaveBeenCalled();
  });

  it('answers 404 for a type whose module has not registered an adapter', async () => {
    const { service } = setup(adapter(ModeratableContentType.Itinerary, {}));
    const e = await failure(service.report(USER, dto()));
    expect(e.getStatus()).toBe(404);
  });

  it('lets an author report their own hidden or private content', async () => {
    const { service } = setup(
      adapter(ModeratableContentType.Itinerary, {
        authorId: USER.id,
        isHidden: true,
        isPublic: false,
      }),
    );
    await expect(
      service.report(USER, dto(ModeratableContentType.Itinerary)),
    ).resolves.toMatchObject({ status: ReportStatus.Open });
  });

  it.each([
    [
      'keyPattern',
      { keyPattern: { reporterId: 1, targetType: 1, targetId: 1 } },
    ],
    ['keyValue only', { keyValue: { reporterId: USER.id, targetId: TARGET } }],
  ])(
    'turns the unique-index violation (%s) into 409 REPORT_ALREADY_FILED',
    async (_, details) => {
      const { service, reports } = setup(
        adapter(ModeratableContentType.Post, {}),
      );
      reports.create.mockRejectedValueOnce(
        Object.assign(new Error('E11000'), { code: 11000, ...details }),
      );
      const e = await failure(service.report(USER, dto()));
      expect(e.getStatus()).toBe(409);
      expect(e.code).toBe('REPORT_ALREADY_FILED');
    },
  );

  it('rethrows any other database error unchanged', async () => {
    const { service, reports } = setup(
      adapter(ModeratableContentType.Post, {}),
    );
    const boom = new Error('connection lost');
    reports.create.mockRejectedValueOnce(boom);
    await expect(service.report(USER, dto())).rejects.toBe(boom);
  });
});

describe('ContentModerationRegistry: GEN-09, GEN-10 adapters', () => {
  it('refuses a second adapter for the same type', () => {
    const registry = new ContentModerationRegistry();
    registry.register(adapter(ModeratableContentType.Post, {}));
    expect(() =>
      registry.register(adapter(ModeratableContentType.Post, {})),
    ).toThrow(/already registered/);
    expect(registry.get(ModeratableContentType.Review)).toBeUndefined();
  });
});

import { Types, type Model } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import {
  ModeratableContentType,
  type ModeratableContent,
} from '../../common/contracts';
import { ContentRegistryService } from './content-registry.service';
import { ReportsService } from './reports.service';
import { ReportStatus, type Report } from './schemas/report.schema';

const REPORTER: AuthUser = {
  id: new Types.ObjectId().toHexString(),
  role: Role.User,
};
const targetId = new Types.ObjectId().toHexString();

function setup(
  content: ModeratableContent | null,
  options: { registered?: boolean; createError?: Error } = {},
) {
  const registry = new ContentRegistryService();
  const find = jest.fn().mockResolvedValue(content);
  if (options.registered !== false) {
    registry.register({
      type: ModeratableContentType.Post,
      find,
      setHidden: jest.fn(),
      remove: jest.fn(),
    });
  }
  const reports = {
    create: jest.fn((doc: Partial<Report>) =>
      options.createError
        ? Promise.reject(options.createError)
        : Promise.resolve({
            toObject: () => ({
              _id: new Types.ObjectId(),
              ...doc,
              status: ReportStatus.Open,
              resolution: null,
              createdAt: new Date('2026-11-17T10:00:00Z'),
            }),
          }),
    ),
  };
  const service = new ReportsService(
    reports as unknown as Model<Report>,
    registry,
  );
  const dto = {
    targetType: ModeratableContentType.Post,
    targetId,
    reason: 'Spam',
  };
  return { service, reports, find, dto };
}

describe('ReportsService (GEN-09)', () => {
  it('creates an OPEN report for visible content', async () => {
    const { service, dto, find } = setup({
      ownerId: new Types.ObjectId().toHexString(),
      hidden: false,
    });
    const report = await service.create(REPORTER, dto);
    expect(find).toHaveBeenCalledWith(targetId);
    expect(report).toMatchObject({
      reporterId: REPORTER.id,
      targetType: 'POST',
      targetId,
      reason: 'Spam',
      status: 'OPEN',
      resolution: null,
      createdAt: '2026-11-17T10:00:00.000Z',
    });
  });

  it.each([
    ['no adapter is registered for the type', null, false],
    ['the item does not exist', null, true],
    [
      'the item is hidden and the reporter is not its author',
      { ownerId: new Types.ObjectId().toHexString(), hidden: true },
      true,
    ],
  ])('answers 404 NOT_FOUND when %s', async (_, content, registered) => {
    const { service, dto, reports } = setup(content, { registered });
    await expect(service.create(REPORTER, dto)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Content not found',
    });
    expect(reports.create).not.toHaveBeenCalled();
  });

  it('lets authors report their own hidden content', async () => {
    const { service, dto } = setup({ ownerId: REPORTER.id, hidden: true });
    await expect(service.create(REPORTER, dto)).resolves.toMatchObject({
      status: 'OPEN',
    });
  });

  it('maps the unique-index violation to 409 DUPLICATE_KEY', async () => {
    const { service, dto } = setup(
      { ownerId: REPORTER.id, hidden: false },
      { createError: Object.assign(new Error('E11000'), { code: 11000 }) },
    );
    await expect(service.create(REPORTER, dto)).rejects.toMatchObject({
      status: 409,
      code: 'DUPLICATE_KEY',
    });
  });

  it('rethrows any other database error', async () => {
    const boom = new Error('db down');
    const { service, dto } = setup(
      { ownerId: REPORTER.id, hidden: false },
      { createError: boom },
    );
    await expect(service.create(REPORTER, dto)).rejects.toBe(boom);
  });
});

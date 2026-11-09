/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { AuditService } from './audit.service';

describe('AuditService', () => {
  const create = jest.fn();
  const exec = jest.fn();
  const chain = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec,
  };
  const find = jest.fn(() => chain);
  const countDocuments = jest.fn(() => ({ exec: () => Promise.resolve(25) }));
  const model: any = { create, find, countDocuments };
  let service: AuditService;

  beforeEach(() => {
    jest.clearAllMocks();
    exec.mockResolvedValue([{ action: 'X' }]);
    service = new AuditService(model);
  });

  it('records an entry with a null actor for system actions', async () => {
    await service.record({
      actorId: null,
      action: 'PAYMENT_SUCCEEDED',
      targetType: 'Payment',
      targetId: 'p1',
    });
    expect(create).toHaveBeenCalledWith({
      actorId: null,
      action: 'PAYMENT_SUCCEEDED',
      targetType: 'Payment',
      targetId: 'p1',
      metadata: undefined,
    });
  });

  it('exposes no update or delete API (entries are immutable)', () => {
    const names = Object.getOwnPropertyNames(AuditService.prototype);
    expect(names.sort()).toEqual(['constructor', 'list', 'record']);
  });

  it('lists newest first with page size 10 and no filter by default', async () => {
    const res = await service.list({ page: 1, limit: 10 });
    expect(find).toHaveBeenCalledWith({});
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(chain.skip).toHaveBeenCalledWith(0);
    expect(chain.limit).toHaveBeenCalledWith(10);
    expect(res).toEqual({
      items: [{ action: 'X' }],
      page: 1,
      limit: 10,
      total: 25,
      totalPages: 3,
    });
  });

  it('filters by actor, action and date range', async () => {
    await service.list({
      page: 2,
      limit: 10,
      actorId: 'u1',
      action: 'USER_SUSPENDED',
      from: '2026-01-01',
      to: '2026-01-31',
    });
    expect(find).toHaveBeenCalledWith({
      actorId: 'u1',
      action: 'USER_SUSPENDED',
      createdAt: {
        $gte: new Date('2026-01-01'),
        $lte: new Date('2026-01-31'),
      },
    });
    expect(chain.skip).toHaveBeenCalledWith(10);
  });
});

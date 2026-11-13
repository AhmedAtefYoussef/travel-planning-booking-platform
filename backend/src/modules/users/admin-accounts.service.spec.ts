import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Types, type Connection, type Model } from 'mongoose';
import type { AuditService } from '../../common/contracts';
import type { PasswordService } from '../../common/security/password.service';
import type { SessionsService } from './sessions.service';
import { ProviderType, Role } from '../../common/auth/auth.types';
import { AdminAccountsService } from './admin-accounts.service';
import { AccountListQueryDto } from './dto/admin-accounts.dto';
import { AccountStatus, type User } from './schemas/user.schema';

function setup(rows: unknown[] = [], total = rows.length) {
  const exec = (value: unknown) => ({ exec: () => Promise.resolve(value) });
  const chain = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnValue(exec(rows)),
  };
  const users = {
    find: jest.fn().mockReturnValue(chain),
    countDocuments: jest.fn().mockReturnValue(exec(total)),
  };
  return {
    service: new AdminAccountsService(
      users as unknown as Model<User>,
      {} as Connection,
      {} as PasswordService,
      {} as SessionsService,
      {} as AuditService,
    ),
    users,
    chain,
  };
}

const query = (q: object) => plainToInstance(AccountListQueryDto, q);

describe('AdminAccountsService (ACC-14)', () => {
  it('lists everyone, newest first, 10 per page, without credentials', async () => {
    const id = new Types.ObjectId();
    const hotel = new Types.ObjectId();
    const { service, users, chain } = setup(
      [
        {
          _id: id,
          name: 'Hotel Mod',
          email: 'mod@example.com',
          role: Role.HotelModerator,
          status: AccountStatus.Active,
          assignedProvider: { type: ProviderType.Hotel, providerId: hotel },
          createdAt: new Date('2026-11-11T10:00:00Z'),
        },
      ],
      21,
    );
    const page = await service.list(query({ page: 3 }));

    expect(users.find).toHaveBeenCalledWith(
      {},
      'name email role status assignedProvider createdAt',
    );
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(chain.skip).toHaveBeenCalledWith(20);
    expect(chain.limit).toHaveBeenCalledWith(10);
    expect(page).toEqual({
      items: [
        {
          id: id.toHexString(),
          name: 'Hotel Mod',
          email: 'mod@example.com',
          role: Role.HotelModerator,
          status: AccountStatus.Active,
          registeredAt: '2026-11-11T10:00:00.000Z',
          assignedProvider: {
            type: ProviderType.Hotel,
            providerId: hotel.toHexString(),
          },
        },
      ],
      page: 3,
      limit: 10,
      total: 21,
      totalPages: 3,
    });
  });

  it('combines role, status and a case-insensitive name-or-email search', () => {
    const { service } = setup();
    const filter = service.filterFor(
      query({ q: 'Mona', role: Role.User, status: AccountStatus.Suspended }),
    );
    expect(filter.role).toBe(Role.User);
    expect(filter.status).toBe(AccountStatus.Suspended);
    const [byName, byEmail] = filter.$or as { name?: RegExp; email?: RegExp }[];
    expect(byName.name).toEqual(/Mona/i);
    expect(byEmail.email).toEqual(/Mona/i);
  });

  it('treats regex characters in the search as plain text', () => {
    const { service } = setup();
    const filter = service.filterFor(query({ q: 'a.b*(c)+' }));
    const text = (filter.$or as { name: RegExp }[])[0].name;
    expect(text.test('a.b*(c)+')).toBe(true);
    expect(text.test('aXbbbc')).toBe(false);
  });

  it('applies no filter when none is given', () => {
    expect(setup().service.filterFor(query({}))).toEqual({});
  });
});

describe('AccountListQueryDto (ACC-14)', () => {
  const failing = (q: object) => validateSync(query(q)).map((e) => e.property);

  it('accepts the filters in any letter case and trims the search', () => {
    const dto = query({
      q: '  mona ',
      role: 'hotel_moderator',
      status: 'active',
    });
    expect(failing(dto)).toEqual([]);
    expect(dto).toMatchObject({
      q: 'mona',
      role: Role.HotelModerator,
      status: AccountStatus.Active,
      page: 1,
    });
  });

  it.each([
    [{ role: 'ROOT' }, 'role'],
    [{ status: 'BANNED' }, 'status'],
    [{ q: '   ' }, 'q'],
    [{ q: 'x'.repeat(101) }, 'q'],
    [{ page: '0' }, 'page'],
  ])('rejects %p', (q, field) => {
    expect(failing(q)).toEqual([field]);
  });
});

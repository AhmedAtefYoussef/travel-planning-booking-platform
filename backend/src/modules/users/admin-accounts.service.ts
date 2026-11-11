import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, Model } from 'mongoose';
import { Page, paginate } from '../../common/pagination/pagination';
import type {
  AccountListQueryDto,
  AccountSummaryDto,
} from './dto/admin-accounts.dto';
import { User } from './schemas/user.schema';

/** Characters with a meaning in a regular expression; escaped so a search is always plain text. */
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/** Only what the list shows: the password hash and lockout counters are never read. */
const SUMMARY_FIELDS = 'name email role status assignedProvider createdAt';

/** Admin account management (ACC-14 list; ACC-07a reset and ACC-13 moderators follow). */
@Injectable()
export class AdminAccountsService {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  /** ACC-14: newest registrations first, 10 per page (GEN-05). */
  async list(query: AccountListQueryDto): Promise<Page<AccountSummaryDto>> {
    const page = await paginate(this.users, this.filterFor(query), query.page, {
      sort: { createdAt: -1 },
      projection: SUMMARY_FIELDS,
    });
    // paginate() returns lean documents, which always carry _id.
    const rows = page.items as unknown as UserRow[];
    return { ...page, items: rows.map(toSummary) };
  }

  filterFor(query: AccountListQueryDto): FilterQuery<User> {
    const filter: FilterQuery<User> = {};
    if (query.role) filter.role = query.role;
    if (query.status) filter.status = query.status;
    if (query.q) {
      const text = new RegExp(query.q.replace(REGEX_SPECIALS, '\\$&'), 'i');
      filter.$or = [{ name: text }, { email: text }];
    }
    return filter;
  }
}

type UserRow = Pick<
  User,
  'name' | 'email' | 'role' | 'status' | 'assignedProvider' | 'createdAt'
> & { _id: { toHexString(): string } };

function toSummary(user: UserRow): AccountSummaryDto {
  return {
    id: user._id.toHexString(),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    registeredAt: user.createdAt.toISOString(),
    ...(user.assignedProvider
      ? {
          assignedProvider: {
            type: user.assignedProvider.type,
            providerId: user.assignedProvider.providerId.toHexString(),
          },
        }
      : {}),
  };
}

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { UserContact, UserContacts } from '../../common/contracts';
import { AccountStatus, User } from './schemas/user.schema';

/** USER_CONTACTS implementation (GEN-01-B): who can be emailed, in one query for any number of users. */
@Injectable()
export class UserContactsService implements UserContacts {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  async contactsOf(userIds: string[]): Promise<UserContact[]> {
    const ids = userIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (!ids.length) return [];
    const found = await this.users
      .find({
        _id: { $in: ids },
        status: { $ne: AccountStatus.Deactivated },
        email: { $exists: true, $ne: '' },
      })
      .select('name email')
      .lean()
      .exec();
    return found.map((u) => ({
      id: u._id.toHexString(),
      name: u.name,
      email: u.email,
    }));
  }
}

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Model } from 'mongoose';
import type { ProviderType } from '../../common/auth/auth.types';
import type {
  AccountAdmin,
  AdministeredAccount,
  SessionAccountStatus,
} from '../../common/contracts';
import { User } from './schemas/user.schema';
import { SessionsService } from './sessions.service';

/**
 * ACCOUNT_ADMIN implementation (ACC-15, ACC-16): what the admin module needs from accounts and
 * sessions to suspend and reactivate, each step joining the admin's transaction.
 */
@Injectable()
export class AccountAdminService implements AccountAdmin {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly sessions: SessionsService,
  ) {}

  async find(
    userId: string,
    session?: ClientSession,
  ): Promise<AdministeredAccount | null> {
    if (!Types.ObjectId.isValid(userId)) return null;
    const user = await this.users
      .findById(userId)
      .select('name role status')
      .session(session ?? null)
      .lean()
      .exec();
    if (!user) return null;
    return {
      id: user._id.toHexString(),
      name: user.name,
      role: user.role,
      status: user.status,
    };
  }

  async changeStatus(
    userId: string,
    from: SessionAccountStatus,
    to: SessionAccountStatus,
    session: ClientSession,
  ): Promise<boolean> {
    const res = await this.users
      .updateOne(
        { _id: new Types.ObjectId(userId), status: from },
        { $set: { status: to } },
        { session },
      )
      .exec();
    return res.modifiedCount === 1;
  }

  revokeAllSessions(userId: string, session: ClientSession): Promise<void> {
    return this.sessions.revokeAllForUser(userId, { session });
  }

  async moderatorsOf(
    type: ProviderType,
    providerId: string,
    session?: ClientSession,
  ): Promise<string[]> {
    if (!Types.ObjectId.isValid(providerId)) return [];
    const rows = await this.users
      .find({
        'assignedProvider.type': type,
        'assignedProvider.providerId': new Types.ObjectId(providerId),
      })
      .select('_id')
      .session(session ?? null)
      .lean()
      .exec();
    return rows.map((r) => r._id.toHexString());
  }
}

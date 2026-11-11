import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Role } from '../../common/auth/auth.types';
import { PasswordService } from '../../common/security/password.service';
import { meetsPasswordRules, PASSWORD_RULE_MESSAGE } from './password-rules';
import { AccountStatus, User } from './schemas/user.schema';

export const SEEDED_ADMIN_NAME = 'Platform Admin';

export interface AdminSeedInput {
  email: string;
  password: string;
}

export interface AdminSeedResult {
  email: string;
  /** false when the admin already existed; its password is then left unchanged. */
  created: boolean;
}

const DUPLICATE_KEY = 11000;

/**
 * ACC-18: admin accounts exist only through this seed (`npm run seed`, from ADMIN_SEED_EMAIL and
 * ADMIN_SEED_PASSWORD). Registration always creates a USER, so there is no admin self-registration.
 *
 * Safe to run again: an existing admin is never duplicated and its password is not reset, because the
 * admin may have changed it since. An existing non-admin account with that email is never promoted.
 */
@Injectable()
export class AdminSeedService {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly passwords: PasswordService,
  ) {}

  async seedAdmin(input: AdminSeedInput): Promise<AdminSeedResult> {
    const email = input.email.trim().toLowerCase();
    if (!meetsPasswordRules(input.password)) {
      throw new Error(`ADMIN_SEED_PASSWORD: ${PASSWORD_RULE_MESSAGE}`);
    }
    const passwordHash = await this.passwords.hash(input.password);

    try {
      // The unique email index decides, so two seeds running at once still create one admin.
      await this.users.create({
        name: SEEDED_ADMIN_NAME,
        email,
        passwordHash,
        role: Role.Admin,
        status: AccountStatus.Active,
        mustChangePassword: false,
      });
      this.logger.log(`Admin ${email} created`);
      return { email, created: true };
    } catch (error) {
      if ((error as { code?: number }).code !== DUPLICATE_KEY) throw error;
    }

    const existing = await this.users.findOne({ email }).lean();
    if (existing?.role !== Role.Admin) {
      throw new Error(
        `ADMIN_SEED_EMAIL ${email} already belongs to a ${existing?.role ?? 'non-admin'} account; ` +
          'choose another email (accounts are never promoted to admin)',
      );
    }
    this.logger.log(`Admin ${email} already exists; left unchanged`);
    return { email, created: false };
  }
}

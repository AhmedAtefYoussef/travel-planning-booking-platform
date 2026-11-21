/**
 * Auth helpers for e2e suites (docs/architecture/auth-migration.md, step 3). A suite that uses them
 * does not care which mechanism is active, so retiring the stub later is a change to this file only.
 */
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  MODERATOR_PROVIDER,
  ProviderType,
  Role,
} from '../../src/common/auth/auth.types';
import { PasswordService } from '../../src/common/security/password.service';
import { User } from '../../src/modules/users';

/** Stub header (x-dev-user), for suites that do not need a real account. */
export function asUser(
  role: Role,
  ids: { userId?: string; providerId?: string } = {},
): Record<string, string> {
  const parts: string[] = [role];
  if (ids.userId || ids.providerId) parts.push(ids.userId ?? '');
  if (ids.providerId) parts.push(ids.providerId);
  return { 'x-dev-user': parts.join(':') };
}

export interface LoggedIn {
  userId: string;
  email: string;
  /** "access_token=...": pass to `.set('Cookie', cookie)`. */
  cookie: string;
  /** "refresh_token=...". */
  refreshCookie: string;
}

export const TEST_PASSWORD = 'Travel2026';

/**
 * Creates a real account of `role` (moderators get a provider) and logs it in through
 * POST /api/auth/login, returning the httpOnly cookies exactly as a browser would hold them.
 */
export async function loginAs(
  app: INestApplication<App>,
  role: Role,
  options: { providerId?: string } = {},
): Promise<LoggedIn> {
  const users = app.get<Model<User>>(getModelToken(User.name));
  const passwords = app.get(PasswordService);
  const email = `${role.toLowerCase()}.${new Types.ObjectId().toHexString()}@example.com`;
  const providerType: ProviderType | undefined = MODERATOR_PROVIDER[role];
  const user = await users.create({
    name: `E2E ${role}`,
    email,
    passwordHash: await passwords.hash(TEST_PASSWORD),
    role,
    ...(providerType
      ? {
          assignedProvider: {
            type: providerType,
            providerId: new Types.ObjectId(options.providerId),
          },
        }
      : {}),
  });

  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: TEST_PASSWORD })
    .expect(200);
  const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
  const find = (name: string) =>
    (cookies.find((c) => c.startsWith(`${name}=`)) ?? '').split(';')[0];
  return {
    userId: user._id.toHexString(),
    email,
    cookie: find('access_token'),
    refreshCookie: find('refresh_token'),
  };
}

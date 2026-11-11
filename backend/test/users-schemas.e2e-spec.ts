import { createHash, randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { App } from 'supertest/types';
import { ProviderType, Role } from '../src/common/auth/auth.types';
import { PasswordService } from '../src/common/security/password.service';
import {
  AccountStatus,
  AdminSeedService,
  Session,
  User,
} from '../src/modules/users';
import { createTestApp } from './support/create-test-app';

const oid = () => new Types.ObjectId();
const tokenHash = () =>
  createHash('sha256').update(randomBytes(32)).digest('hex');
const inAWeek = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
/** A raw token (header.payload.signature), not a SHA-256 hex hash; built at runtime so it never looks like a secret. */
const RAW_JWT_SHAPE = ['header', 'payload', 'signature'].join('.');

describe('Users and sessions schemas + admin seed (e2e): TRVL-137, ACC-18', () => {
  let app: INestApplication<App>;
  let users: Model<User>;
  let sessions: Model<Session>;
  let seed: AdminSeedService;
  let passwords: PasswordService;

  const traveller = (overrides: Partial<User> = {}) => ({
    name: 'Mona Traveller',
    email: `mona.${oid().toHexString()}@example.com`,
    passwordHash: 'x'.repeat(60),
    ...overrides,
  });

  beforeAll(async () => {
    app = await createTestApp();
    users = app.get(getModelToken(User.name));
    sessions = app.get(getModelToken(Session.name));
    seed = app.get(AdminSeedService);
    passwords = app.get(PasswordService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('users', () => {
    it('defaults a new account to an active USER with no lockout', async () => {
      const user = await users.create(traveller());
      expect(user).toMatchObject({
        role: Role.User,
        status: AccountStatus.Active,
        mustChangePassword: false,
        failedLoginCount: 0,
      });
      expect(user.lockedUntil).toBeUndefined();
      expect(user.assignedProvider).toBeUndefined();
      expect(user.createdAt).toBeInstanceOf(Date);
    });

    it('stores emails lowercased and rejects the same email in another case (unique index)', async () => {
      const email = `Case.${oid().toHexString()}@Example.com`;
      const user = await users.create(traveller({ email: `  ${email} ` }));
      expect(user.email).toBe(email.toLowerCase());

      await expect(
        users.create(traveller({ email: email.toUpperCase() })),
      ).rejects.toMatchObject({ code: 11000 });
      expect(await users.countDocuments({ email: email.toLowerCase() })).toBe(
        1,
      );
    });

    it('never returns the password hash unless asked, and never serialises it', async () => {
      const { _id } = await users.create(traveller());

      const plain = await users.findById(_id);
      expect(plain?.passwordHash).toBeUndefined();

      const withHash = await users.findById(_id).select('+passwordHash');
      expect(withHash?.passwordHash).toHaveLength(60);
      const json = withHash!.toJSON() as unknown as Record<string, unknown>;
      expect(json.passwordHash).toBeUndefined();
      expect(json._id).toBeUndefined();
      expect(json.id).toBe(_id.toHexString());
    });

    it('requires a moderator to be linked to exactly one provider of the matching type (ACC-13)', async () => {
      await expect(
        users.create(traveller({ role: Role.HotelModerator })),
      ).rejects.toThrow(/assigned to exactly one hotel/);

      await expect(
        users.create(
          traveller({
            role: Role.HotelModerator,
            assignedProvider: { type: ProviderType.Airline, providerId: oid() },
          }),
        ),
      ).rejects.toThrow(/assigned to exactly one hotel/);

      const moderator = await users.create(
        traveller({
          role: Role.AirlineModerator,
          assignedProvider: { type: ProviderType.Airline, providerId: oid() },
        }),
      );
      expect(moderator.assignedProvider?.type).toBe(ProviderType.Airline);
    });

    it('refuses a provider link on a traveller or an admin', async () => {
      for (const role of [Role.User, Role.Admin]) {
        await expect(
          users.create(
            traveller({
              role,
              assignedProvider: { type: ProviderType.Hotel, providerId: oid() },
            }),
          ),
        ).rejects.toThrow(/Only moderators/);
      }
    });

    it.each([
      ['an unknown role', { role: 'ROOT' }],
      ['an unknown status', { status: 'BANNED' }],
      ['a malformed currency', { preferredCurrency: 'dollars' }],
      ['a negative failed-login count', { failedLoginCount: -1 }],
      ['a fractional failed-login count', { failedLoginCount: 1.5 }],
      ['a missing name', { name: undefined }],
    ])('rejects %s', async (_label, overrides) => {
      await expect(
        users.create(traveller(overrides as Partial<User>)),
      ).rejects.toThrow(/validation failed/i);
    });

    it('normalises the preferred currency to upper case', async () => {
      const user = await users.create(traveller({ preferredCurrency: 'egp' }));
      expect(user.preferredCurrency).toBe('EGP');
    });
  });

  describe('sessions', () => {
    it('has a TTL index on expiresAt so MongoDB removes expired sessions', async () => {
      const indexes = await sessions.collection.indexes();
      const ttl = indexes.find((i) => i.key.expiresAt === 1);
      expect(ttl?.expireAfterSeconds).toBe(0);
      const byToken = indexes.find((i) => i.key.refreshTokenHash === 1);
      expect(byToken?.unique).toBe(true);
      expect(indexes.some((i) => i.key.userId === 1)).toBe(true);
    });

    it('stores a hashed refresh token with activity and expiry, unrevoked', async () => {
      const userId = oid();
      const session = await sessions.create({
        userId,
        refreshTokenHash: tokenHash(),
        expiresAt: inAWeek(),
      });
      expect(session.userId.equals(userId)).toBe(true);
      expect(session.lastActivityAt).toBeInstanceOf(Date);
      expect(session.revokedAt).toBeUndefined();
    });

    it('refuses a raw (unhashed) refresh token and a reused token hash', async () => {
      await expect(
        sessions.create({
          userId: oid(),
          refreshTokenHash: RAW_JWT_SHAPE,
          expiresAt: inAWeek(),
        }),
      ).rejects.toThrow(/validation failed/i);

      const hash = tokenHash();
      await sessions.create({
        userId: oid(),
        refreshTokenHash: hash,
        expiresAt: inAWeek(),
      });
      await expect(
        sessions.create({
          userId: oid(),
          refreshTokenHash: hash,
          expiresAt: inAWeek(),
        }),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('requires an expiry', async () => {
      await expect(
        sessions.create({ userId: oid(), refreshTokenHash: tokenHash() }),
      ).rejects.toThrow(/expiresAt/);
    });
  });

  describe('admin seed (ACC-18)', () => {
    const email = 'seed.admin@example.com';
    const password = 'SeedAdmin2026';

    it('creates an active admin whose password verifies, and only once', async () => {
      await expect(
        seed.seedAdmin({ email: 'Seed.Admin@Example.com', password }),
      ).resolves.toEqual({ email, created: true });
      await expect(seed.seedAdmin({ email, password })).resolves.toEqual({
        email,
        created: false,
      });

      const admins = await users.find({ email }).select('+passwordHash');
      expect(admins).toHaveLength(1);
      expect(admins[0]).toMatchObject({
        role: Role.Admin,
        status: AccountStatus.Active,
        mustChangePassword: false,
      });
      expect(admins[0].termsAcceptedAt).toBeUndefined();
      await expect(
        passwords.verify(password, admins[0].passwordHash),
      ).resolves.toBe(true);
    });

    it('does not reset an existing admin password on a re-run', async () => {
      await seed.seedAdmin({ email, password: 'AnotherPass99' });
      const admin = await users.findOne({ email }).select('+passwordHash');
      await expect(
        passwords.verify(password, admin!.passwordHash),
      ).resolves.toBe(true);
      await expect(
        passwords.verify('AnotherPass99', admin!.passwordHash),
      ).resolves.toBe(false);
    });

    it('creates one admin when two seeds run at the same time', async () => {
      const raceEmail = 'race.admin@example.com';
      const results = await Promise.all([
        seed.seedAdmin({ email: raceEmail, password }),
        seed.seedAdmin({ email: raceEmail, password }),
      ]);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      expect(await users.countDocuments({ email: raceEmail })).toBe(1);
    });

    it('never promotes an existing traveller to admin', async () => {
      const taken = traveller();
      await users.create(taken);
      await expect(
        seed.seedAdmin({ email: taken.email, password }),
      ).rejects.toThrow(/already belongs to a USER account/);
      const after = await users.findOne({ email: taken.email });
      expect(after?.role).toBe(Role.User);
    });

    it('rejects a weak seed password and writes nothing', async () => {
      const weakEmail = 'weak.admin@example.com';
      await expect(
        seed.seedAdmin({ email: weakEmail, password: 'password' }),
      ).rejects.toThrow(/ADMIN_SEED_PASSWORD/);
      expect(await users.countDocuments({ email: weakEmail })).toBe(0);
    });
  });
});

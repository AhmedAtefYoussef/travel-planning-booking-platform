import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { User } from '../src/modules/users';
import { createTestApp } from './support/create-test-app';

/** ACC-05: 5 consecutive failed logins lock the account for 15 minutes; a success resets the counter. */
describe('Login lockout (e2e): ACC-05', () => {
  let app: INestApplication<App>;
  let users: Model<User>;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Travel2026';
  const WRONG = 'WrongPass1';

  async function registered(): Promise<string> {
    const email = `lockout.${new Types.ObjectId().toHexString()}@example.com`;
    await http()
      .post('/api/auth/register')
      .send({ name: 'Lou', email, password: PASSWORD, acceptTerms: true })
      .expect(201);
    return email;
  }
  const login = (email: string, password: string) =>
    http().post('/api/auth/login').send({ email, password });
  const fail = async (email: string, times: number) => {
    for (let i = 0; i < times; i++) await login(email, WRONG);
  };
  const stateOf = (email: string) =>
    users.findOne({ email }).lean() as Promise<User | null>;

  beforeAll(async () => {
    app = await createTestApp();
    users = app.get(getModelToken(User.name));
  });

  afterAll(async () => {
    await app.close();
  });

  it('4 failures still get the generic 401 and do not lock', async () => {
    const email = await registered();
    for (let i = 1; i <= 4; i++) {
      const res = await login(email, WRONG).expect(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    }
    expect(await stateOf(email)).toMatchObject({ failedLoginCount: 4 });
    expect((await stateOf(email))?.lockedUntil).toBeUndefined();
    await login(email, PASSWORD).expect(200);
  });

  it('the 5th consecutive failure locks the account for 15 minutes with a lockout message', async () => {
    const email = await registered();
    await fail(email, 4);
    const before = Date.now();
    const res = await login(email, WRONG).expect(403);

    expect(res.body).toMatchObject({
      code: 'ACCOUNT_LOCKED',
      message: expect.stringMatching(
        /locked for 15 minutes; try again in 15 minutes/,
      ),
    });
    expect(res.headers['set-cookie']).toBeUndefined();
    const saved = await stateOf(email);
    const lockMs = saved!.lockedUntil!.getTime() - before;
    expect(lockMs).toBeGreaterThan(15 * 60_000 - 5_000);
    expect(lockMs).toBeLessThanOrEqual(15 * 60_000 + 5_000);
    expect(saved!.failedLoginCount).toBe(0);
  });

  it('refuses even the right password while locked, and does not extend the lock', async () => {
    const email = await registered();
    await fail(email, 5);
    const lockedUntil = (await stateOf(email))!.lockedUntil!.getTime();

    const res = await login(email, PASSWORD).expect(403);
    expect(res.body.code).toBe('ACCOUNT_LOCKED');
    await login(email, WRONG).expect(403);
    expect((await stateOf(email))!.lockedUntil!.getTime()).toBe(lockedUntil);
  });

  it('lets the account log in again once the 15 minutes are over, and resets the counter', async () => {
    const email = await registered();
    await fail(email, 5);
    // Simulate the end of the lock.
    await users.updateOne(
      { email },
      { $set: { lockedUntil: new Date(Date.now() - 1000) } },
    );

    await login(email, PASSWORD).expect(200);
    const saved = await stateOf(email);
    expect(saved!.failedLoginCount).toBe(0);
    expect(saved!.lockedUntil).toBeUndefined();
  });

  it('a successful login resets the counter, so failures must be consecutive', async () => {
    const email = await registered();
    await fail(email, 4);
    await login(email, PASSWORD).expect(200);
    expect((await stateOf(email))!.failedLoginCount).toBe(0);

    // 4 more failures after the reset still do not lock (4 + 4, but not consecutive).
    await fail(email, 4);
    await login(email, PASSWORD).expect(200);
  });

  it('locks exactly once when 8 wrong passwords arrive at the same time', async () => {
    const email = await registered();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => login(email, WRONG)),
    );
    const codes = results.map((r) => r.body.code as string);
    expect(
      codes.filter((c) => c === 'ACCOUNT_LOCKED').length,
    ).toBeGreaterThanOrEqual(1);
    expect((await stateOf(email))!.lockedUntil!.getTime()).toBeGreaterThan(
      Date.now(),
    );
    await login(email, PASSWORD).expect(403);
  });

  it('a lockout on one account never affects another account', async () => {
    const locked = await registered();
    const other = await registered();
    await fail(locked, 5);
    await login(other, PASSWORD).expect(200);
  });

  it('unknown emails are never counted or locked', async () => {
    const ghost = `ghost.${new Types.ObjectId().toHexString()}@example.com`;
    for (let i = 0; i < 6; i++) {
      expect((await login(ghost, WRONG).expect(401)).body.code).toBe(
        'INVALID_CREDENTIALS',
      );
    }
    expect(await users.countDocuments({ email: ghost })).toBe(0);
  });

  it('20 simultaneous wrong passwords: only 5 are checked (4 get 401, the 5th locks), the other 15 are refused', async () => {
    const email = await registered();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => login(email, WRONG)),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(4);
    expect(statuses.filter((s) => s === 403)).toHaveLength(16);
    expect(
      results
        .filter((r) => r.status === 403)
        .every((r) => r.body.code === 'ACCOUNT_LOCKED'),
    ).toBe(true);
    const saved = await stateOf(email);
    expect(saved!.lockedUntil!.getTime()).toBeGreaterThan(
      Date.now() + 14 * 60_000,
    );
    await login(email, PASSWORD).expect(403);
  });

  it('19 wrong and 1 right at the same time: at most 5 passwords are checked, and the lock is not lifted by the success', async () => {
    const email = await registered();
    const attempts = Array.from({ length: 20 }, (_, i) =>
      i === 13 ? PASSWORD : WRONG,
    );
    const results = await Promise.all(attempts.map((p) => login(email, p)));
    const statuses = results.map((r) => r.status);
    const generic = statuses.filter((s) => s === 401).length;
    const succeeded = statuses.filter((s) => s === 200).length;
    // Checked passwords: the 401s, the possible 200, and the failure that set the lock.
    expect(generic).toBeLessThanOrEqual(4);
    expect(generic + succeeded).toBeLessThanOrEqual(5);
    if (succeeded === 0) {
      // The correct password was refused unchecked or arrived after the lock: the account stays locked.
      expect((await stateOf(email))!.lockedUntil!.getTime()).toBeGreaterThan(
        Date.now(),
      );
      await login(email, PASSWORD).expect(403);
    }
  });
});

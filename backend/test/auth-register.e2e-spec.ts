import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { PasswordService } from '../src/common/security/password.service';
import { User } from '../src/modules/users';
import { createTestApp } from './support/create-test-app';

/** ACC-01: guest registration with unique email, password rules and mandatory consent. */
describe('Registration (e2e): ACC-01', () => {
  let app: INestApplication<App>;
  let users: Model<User>;
  let passwords: PasswordService;
  const http = () => request(app.getHttpServer());
  const uniqueEmail = () =>
    `mona.${new Types.ObjectId().toHexString()}@example.com`;
  const body = (overrides: Record<string, unknown> = {}) => ({
    name: 'Mona Hassan',
    email: uniqueEmail(),
    password: 'Travel2026',
    acceptTerms: true,
    ...overrides,
  });
  const fieldsOf = (res: request.Response) =>
    (res.body.fieldErrors as { field: string }[]).map((f) => f.field);

  beforeAll(async () => {
    app = await createTestApp();
    users = app.get(getModelToken(User.name));
    passwords = app.get(PasswordService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a guest registers without any login: 201 with the profile, never the password', async () => {
    const payload = body({
      email: `  Mona.${new Types.ObjectId().toHexString()}@Example.COM `,
    });
    const res = await http()
      .post('/api/auth/register')
      .send(payload)
      .expect(201);

    const email = payload.email.trim().toLowerCase();
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[a-f0-9]{24}$/),
      name: 'Mona Hassan',
      email,
      role: 'USER',
      status: 'ACTIVE',
      mustChangePassword: false,
      createdAt: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password"|Travel2026|\$2b\$/);
    expect(res.headers['set-cookie']).toBeUndefined();

    const saved = await users.findById(res.body.id).select('+passwordHash');
    expect(saved?.termsAcceptedAt).toBeInstanceOf(Date);
    expect(saved?.passwordHash).not.toBe('Travel2026');
    await expect(
      passwords.verify('Travel2026', saved!.passwordHash),
    ).resolves.toBe(true);
  });

  it('rejects an email that is already registered, in any letter case: 409 with an email field error', async () => {
    const email = uniqueEmail();
    await http().post('/api/auth/register').send(body({ email })).expect(201);

    const res = await http()
      .post('/api/auth/register')
      .send(body({ email: email.toUpperCase(), name: 'Someone Else' }))
      .expect(409);
    expect(res.body).toMatchObject({
      code: 'EMAIL_ALREADY_REGISTERED',
      fieldErrors: [{ field: 'email', message: 'email is already registered' }],
    });
    expect(await users.countDocuments({ email })).toBe(1);
  });

  it('creates exactly one account when the same email registers twice at once', async () => {
    const email = uniqueEmail();
    const results = await Promise.all([
      http().post('/api/auth/register').send(body({ email })),
      http().post('/api/auth/register').send(body({ email })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await users.countDocuments({ email })).toBe(1);
  });

  it.each([
    ['shorter than 8 characters', 'Trave12'],
    ['without a digit', 'onlyletters'],
    ['without a letter', '12345678'],
  ])(
    'rejects a password %s with an inline password error',
    async (_label, password) => {
      const email = uniqueEmail();
      const res = await http()
        .post('/api/auth/register')
        .send(body({ email, password }))
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(new Set(fieldsOf(res))).toEqual(new Set(['password']));
      expect(await users.countDocuments({ email })).toBe(0);
    },
  );

  it('rejects an invalid email with an inline email error', async () => {
    const res = await http()
      .post('/api/auth/register')
      .send(body({ email: 'not-an-email' }))
      .expect(400);
    expect(fieldsOf(res)).toEqual(['email']);
  });

  it.each([false, 'true', undefined])(
    'refuses registration without consent (acceptTerms = %p)',
    async (acceptTerms) => {
      const email = uniqueEmail();
      const res = await http()
        .post('/api/auth/register')
        .send(body({ email, acceptTerms }))
        .expect(400);
      expect(fieldsOf(res)).toEqual(['acceptTerms']);
      expect(await users.countDocuments({ email })).toBe(0);
    },
  );

  it('returns every broken rule in one response', async () => {
    const res = await http()
      .post('/api/auth/register')
      .send({ name: '', email: 'x', password: 'short', acceptTerms: false })
      .expect(400);
    expect(new Set(fieldsOf(res))).toEqual(
      new Set(['name', 'email', 'password', 'acceptTerms']),
    );
  });

  it.each(['ADMIN', 'HOTEL_MODERATOR'])(
    'nobody can register as %s: a role in the body is rejected and nothing is saved (ACC-18)',
    async (role) => {
      const email = uniqueEmail();
      const res = await http()
        .post('/api/auth/register')
        .send(body({ email, role }))
        .expect(400);
      expect(fieldsOf(res)).toEqual(['role']);
      expect(await users.countDocuments({ email })).toBe(0);
    },
  );

  it('rejects other account fields a guest must not set (status, mustChangePassword)', async () => {
    const res = await http()
      .post('/api/auth/register')
      .send(body({ status: 'ACTIVE', mustChangePassword: false }))
      .expect(400);
    expect(new Set(fieldsOf(res))).toEqual(
      new Set(['status', 'mustChangePassword']),
    );
  });
});

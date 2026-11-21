import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ProviderType, Role } from '../src/common/auth/auth.types';
import { AccountStatus, User } from '../src/modules/users';
import { loginAs } from './support/auth';
import { createTestApp } from './support/create-test-app';

interface Row {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  registeredAt: string;
}

/** ACC-14: paginated admin list of all accounts with search by name or email and role/status filters. */
describe('Admin account list (e2e): ACC-14', () => {
  let app: INestApplication<App>;
  let users: Model<User>;
  let adminCookie: string;
  const list = (query: string, cookie = adminCookie) =>
    request(app.getHttpServer())
      .get(`/api/admin/accounts${query}`)
      .set('Cookie', cookie);

  /** A tag unique to one test, so counts never depend on accounts other suites created. */
  const newTag = () => `acc14x${new Types.ObjectId().toHexString().slice(-8)}`;

  async function seedAccounts(
    tag: string,
    specs: Array<Partial<User> & { name: string }>,
  ) {
    let t = Date.now() - specs.length * 1000;
    for (const spec of specs) {
      await users.create({
        email: `${spec.name.toLowerCase().replace(/\s+/g, '.')}.${tag}@example.com`,
        passwordHash: 'x'.repeat(60),
        ...spec,
        name: `${spec.name} ${tag}`,
      });
      // Distinct registration times so "newest first" is checkable.
      await users.updateOne(
        { name: `${spec.name} ${tag}` },
        { $set: { createdAt: new Date((t += 1000)) } },
        { timestamps: false },
      );
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
    users = app.get(getModelToken(User.name));
    adminCookie = (await loginAs(app, Role.Admin)).cookie;
  });

  afterAll(async () => {
    await app.close();
  });

  it('shows name, email, role, status and registration date, newest first, never credentials', async () => {
    const tag = newTag();
    await seedAccounts(tag, [{ name: 'Older' }, { name: 'Newer' }]);

    const res = await list(`?q=${tag}`).expect(200);
    expect(res.body).toMatchObject({
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
    });
    const rows = res.body.items as Row[];
    expect(rows.map((r) => r.name)).toEqual([`Newer ${tag}`, `Older ${tag}`]);
    expect(Object.keys(rows[0]).sort()).toEqual(
      ['email', 'id', 'name', 'registeredAt', 'role', 'status'].sort(),
    );
    expect(JSON.stringify(res.body)).not.toMatch(
      /passwordHash|failedLoginCount|lockedUntil/,
    );
  });

  it('paginates with the fixed page size of 10', async () => {
    const tag = newTag();
    await seedAccounts(
      tag,
      Array.from({ length: 12 }, (_, i) => ({
        name: `Person${String(i).padStart(2, '0')}`,
      })),
    );

    const first = await list(`?q=${tag}`).expect(200);
    const second = await list(`?q=${tag}&page=2`).expect(200);
    expect(first.body).toMatchObject({ total: 12, totalPages: 2 });
    expect(first.body.items).toHaveLength(10);
    expect(second.body.items).toHaveLength(2);
    const ids = [...first.body.items, ...second.body.items].map(
      (r: Row) => r.id,
    );
    expect(new Set(ids).size).toBe(12);
    expect((await list(`?q=${tag}&page=3`).expect(200)).body.items).toEqual([]);
  });

  it('searches the name or the email, ignoring case', async () => {
    const tag = newTag();
    await seedAccounts(tag, [
      { name: 'Mona Hassan' },
      { name: 'Omar Fathy', email: `omar.monaco.${tag}@example.com` },
      { name: 'Sara Adel' },
    ]);

    const byName = await list(`?q=MONA%20HASSAN%20${tag.toUpperCase()}`).expect(
      200,
    );
    expect(byName.body.items.map((r: Row) => r.name)).toEqual([
      `Mona Hassan ${tag}`,
    ]);

    // "mona" is in Mona's name and in Omar's email.
    const both = await list(`?q=mona`).expect(200);
    const names = (both.body.items as Row[]).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining([`Mona Hassan ${tag}`]));
    const byEmail = await list(`?q=omar.monaco.${tag}`).expect(200);
    expect(byEmail.body.items.map((r: Row) => r.name)).toEqual([
      `Omar Fathy ${tag}`,
    ]);
  });

  it('filters by role and by status, and combines filters', async () => {
    const tag = newTag();
    await seedAccounts(tag, [
      { name: 'Active User' },
      { name: 'Suspended User', status: AccountStatus.Suspended },
      {
        name: 'Hotel Mod',
        role: Role.HotelModerator,
        assignedProvider: {
          type: ProviderType.Hotel,
          providerId: new Types.ObjectId(),
        },
      },
      { name: 'Gone User', status: AccountStatus.Deactivated },
    ]);
    const names = async (query: string) =>
      ((await list(query).expect(200)).body.items as Row[])
        .map((r) => r.name)
        .sort();

    expect(await names(`?q=${tag}&role=HOTEL_MODERATOR`)).toEqual([
      `Hotel Mod ${tag}`,
    ]);
    expect(await names(`?q=${tag}&status=suspended`)).toEqual([
      `Suspended User ${tag}`,
    ]);
    expect(await names(`?q=${tag}&status=DEACTIVATED`)).toEqual([
      `Gone User ${tag}`,
    ]);
    expect(await names(`?q=${tag}&role=USER&status=ACTIVE`)).toEqual([
      `Active User ${tag}`,
    ]);
    expect(await names(`?q=${tag}&role=ADMIN`)).toEqual([]);

    const moderator = (await list(`?q=${tag}&role=HOTEL_MODERATOR`)).body
      .items[0];
    expect(moderator.assignedProvider.type).toBe('HOTEL');
  });

  it('includes admins and moderators, not only travellers', async () => {
    const res = await list('?role=ADMIN').expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect((res.body.items as Row[]).every((r) => r.role === 'ADMIN')).toBe(
      true,
    );
  });

  it('treats regex characters in the search as plain text', async () => {
    await list('?q=.*').expect(200);
    const res = await list(`?q=${encodeURIComponent('(unclosed[')}`).expect(
      200,
    );
    expect(res.body.items).toEqual([]);
  });

  it('rejects bad filters and any page-size parameter (GEN-05)', async () => {
    const field = async (query: string) =>
      (
        (await list(query).expect(400)).body.fieldErrors as
          { field: string }[] | undefined
      )?.map((f) => f.field);
    expect(await field('?role=ROOT')).toEqual(['role']);
    expect(await field('?status=BANNED')).toEqual(['status']);
    expect(await field('?page=0')).toEqual(['page']);
    await list('?limit=50').expect(400);
  });

  it('is admins only: users and moderators get 403, guests 401', async () => {
    for (const role of [
      Role.User,
      Role.HotelModerator,
      Role.AirlineModerator,
    ]) {
      const someone = await loginAs(app, role);
      await list('', someone.cookie).expect(403);
    }
    await request(app.getHttpServer()).get('/api/admin/accounts').expect(401);
  });
});

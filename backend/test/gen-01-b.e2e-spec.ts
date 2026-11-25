import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { AccountStatus, User } from '../src/modules/users';
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';
import { FakeMail, fakeMailOverride } from './support/fake-mail';

/** GEN-01-B: the GEN-01 notifications and moderator invitations also go out by email (SMTP; Mailpit in dev). */
describe('Notifications and invitations by email (e2e): GEN-01-B', () => {
  let app: INestApplication<App>;
  let users: Model<User>;
  let admin: LoggedIn;
  const mail = new FakeMail();
  const http = () => request(app.getHttpServer());

  const patchAccount = (id: string, action: 'suspend' | 'reactivate') =>
    http()
      .patch(`/api/admin/accounts/${id}/${action}`)
      .set('Cookie', admin.cookie)
      .send({});
  const newAirline = async (code: string) =>
    (
      await http()
        .post('/api/airlines')
        .set('Cookie', admin.cookie)
        .send({ name: `Mail Air ${code}`, code })
        .expect(201)
    ).body.id as string;
  const createModerator = (body: object) =>
    http().post('/api/admin/moderators').set('Cookie', admin.cookie).send(body);
  const uniqueEmail = () =>
    `inv.${new Types.ObjectId().toHexString()}@example.com`;

  beforeAll(async () => {
    app = await createTestApp([], [fakeMailOverride(mail)]);
    users = app.get(getModelToken(User.name));
    admin = await loginAs(app, Role.Admin);
  });

  afterAll(async () => {
    await app.close();
  });

  it('emails an account suspension and its reactivation to the account owner, once each', async () => {
    const user = await loginAs(app, Role.User);

    await patchAccount(user.userId, 'suspend').expect(200);
    await mail.waitFor(user.email, 1);
    await mail.settle();
    expect(mail.to(user.email)).toHaveLength(1);
    const [suspended] = mail.to(user.email);
    expect(suspended.subject).toMatch(/^Account suspended/);
    expect(suspended.text).toContain('suspended');
    expect(suspended.html).toContain('<h2');

    await patchAccount(user.userId, 'reactivate').expect(200);
    await mail.waitFor(user.email, 2);
    await mail.settle();
    expect(mail.to(user.email).map((m) => m.subject)).toEqual([
      expect.stringMatching(/^Account suspended/) as string,
      expect.stringMatching(/^Account reactivated/) as string,
    ]);
    // Nobody else was emailed about it.
    expect(mail.sent.filter((m) => m.to === admin.email)).toHaveLength(0);
  });

  it('sends nothing when the change is refused or rolled back (404, 409)', async () => {
    const user = await loginAs(app, Role.User);
    await patchAccount(user.userId, 'suspend').expect(200);
    await mail.waitFor(user.email, 1);

    // Already suspended: the transaction aborts, so its notification and email never happen.
    await patchAccount(user.userId, 'suspend').expect(409);
    await patchAccount(new Types.ObjectId().toHexString(), 'suspend').expect(
      404,
    );
    await mail.settle();

    expect(mail.to(user.email)).toHaveLength(1);
  });

  it('emails each moderator of a provider that was deactivated, and only them', async () => {
    const airlineId = await newAirline('MLA');
    const moderator = await loginAs(app, Role.AirlineModerator, {
      providerId: airlineId,
    });
    const bystander = await loginAs(app, Role.User);

    await http()
      .patch(`/api/admin/providers/airline/${airlineId}/deactivate`)
      .set('Cookie', admin.cookie)
      .send({})
      .expect(200);
    await mail.waitFor(moderator.email, 1);
    await mail.settle();

    expect(mail.to(moderator.email)).toHaveLength(1);
    expect(mail.to(moderator.email)[0].subject).toMatch(
      /^Provider deactivated/,
    );
    expect(mail.to(bystander.email)).toHaveLength(0);
  });

  it('does not email an account its owner deactivated (ACC-12)', async () => {
    const airlineId = await newAirline('MLD');
    const active = await loginAs(app, Role.AirlineModerator, {
      providerId: airlineId,
    });
    const gone = await loginAs(app, Role.AirlineModerator, {
      providerId: airlineId,
    });
    await users.updateOne(
      { _id: new Types.ObjectId(gone.userId) },
      { $set: { status: AccountStatus.Deactivated } },
    );

    await http()
      .patch(`/api/admin/providers/airline/${airlineId}/deactivate`)
      .set('Cookie', admin.cookie)
      .send({})
      .expect(200);
    await mail.waitFor(active.email, 1);
    await mail.settle();

    expect(mail.to(active.email)).toHaveLength(1);
    expect(mail.to(gone.email)).toHaveLength(0);
  });

  it('a failing mail server never fails the request, and the in-app notification is still there', async () => {
    const user = await loginAs(app, Role.User);
    mail.failNext = true;

    await patchAccount(user.userId, 'suspend').expect(200);
    await mail.settle();

    expect(mail.to(user.email)).toHaveLength(0);
    expect((await users.findById(user.userId).lean())?.status).toBe(
      AccountStatus.Suspended,
    );
    // Reactivating works and its email is delivered: the failure was not sticky.
    await patchAccount(user.userId, 'reactivate').expect(200);
    await mail.waitFor(user.email, 1);
  });

  it('sends a new moderator an invitation that links to the login page and never contains the password', async () => {
    const providerId = await newAirline('MLB');
    const email = uniqueEmail();

    await createModerator({
      name: 'Ops <Lead>',
      email,
      role: 'AIRLINE_MODERATOR',
      providerId,
      temporaryPassword: 'Temp2026x',
    }).expect(201);
    await mail.waitFor(email, 1);
    await mail.settle();

    expect(mail.to(email)).toHaveLength(1);
    const [invite] = mail.to(email);
    expect(invite.subject).toMatch(/invited/i);
    expect(invite.text).toContain('http://localhost:3001/login');
    expect(invite.html).toContain('href="http://localhost:3001/login"');
    // The name is escaped in HTML.
    expect(invite.html).toContain('Ops &lt;Lead&gt;');
    expect(JSON.stringify(invite)).not.toContain('Temp2026x');
  });

  it('sends no invitation when the moderator is not created (404 provider, 409 duplicate email)', async () => {
    const providerId = await newAirline('MLC');
    const email = uniqueEmail();
    const body = {
      name: 'Ops',
      email,
      role: 'AIRLINE_MODERATOR',
      providerId,
      temporaryPassword: 'Temp2026x',
    };

    await createModerator({
      ...body,
      providerId: new Types.ObjectId().toHexString(),
    }).expect(404);
    await mail.settle();
    expect(mail.to(email)).toHaveLength(0);

    await createModerator(body).expect(201);
    await mail.waitFor(email, 1);
    await createModerator(body).expect(409);
    await mail.settle();
    expect(mail.to(email)).toHaveLength(1);
  });
});

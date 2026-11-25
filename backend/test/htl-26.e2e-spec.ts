import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { Hotel, Review } from '../src/modules/hotels';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/**
 * HTL-26: the hotel's assigned moderator replies to a review; the reply shows in the public list,
 * can be replaced, is refused for hidden reviews and is audited. Reviews are written straight to the
 * collection, since creating them (HTL-23) is covered by hotel-reviews.e2e-spec.ts.
 */
describe('Review replies (e2e): HTL-26', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  let reviews: Model<Review>;
  let hotels: Model<Hotel>;
  let hotelId: string;
  let otherHotelId: string;
  let moderator: LoggedIn;
  let otherModerator: LoggedIn;
  let traveller: LoggedIn;

  const newReview = async (over: object = {}) =>
    (
      await reviews.create({
        hotelId: new Types.ObjectId(hotelId),
        reservationId: new Types.ObjectId(),
        userId: new Types.ObjectId(traveller.userId),
        rating: 4,
        text: 'Nice stay',
        ...over,
      })
    )._id.toHexString();
  const reply = (id: string, who: LoggedIn | null, body: object) => {
    const req = http().post(`/api/reviews/${id}/reply`);
    if (who) req.set('Cookie', who.cookie);
    return req.send(body);
  };

  beforeAll(async () => {
    app = await createTestApp();
    reviews = app.get(getModelToken(Review.name));
    hotels = app.get(getModelToken(Hotel.name));
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    const create = async (name: string) =>
      (
        await http()
          .post('/api/hotels')
          .set('x-dev-user', 'ADMIN')
          .send({ name, address: '1 Nile street', cityId: 'cairo' })
          .expect(201)
      ).body.id as string;
    hotelId = await create('Reply Hotel');
    otherHotelId = await create('Other Reply Hotel');
    moderator = await loginAs(app, Role.HotelModerator, {
      providerId: hotelId,
    });
    otherModerator = await loginAs(app, Role.HotelModerator, {
      providerId: otherHotelId,
    });
    traveller = await loginAs(app, Role.User);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets the assigned moderator reply, then replace the reply, and shows it publicly', async () => {
    const id = await newReview();
    const before = await hotels.findById(hotelId).lean();

    const first = await reply(id, moderator, { text: '  Thank you!  ' }).expect(
      200,
    );
    expect(first.body).toMatchObject({
      id,
      rating: 4,
      text: 'Nice stay',
      reply: { text: 'Thank you!' },
    });
    expect(first.body.reply).not.toHaveProperty('moderatorId');
    const created = first.body.reply.createdAt as string;

    const second = await reply(id, moderator, {
      text: 'We hope to see you.',
    }).expect(200);
    expect(second.body.reply.text).toBe('We hope to see you.');
    expect(second.body.reply.createdAt).toBe(created);
    expect(
      new Date(second.body.reply.updatedAt).getTime(),
    ).toBeGreaterThanOrEqual(new Date(created).getTime());

    const stored = await reviews.findById(id).lean();
    expect(stored!.reply!.moderatorId.toHexString()).toBe(moderator.userId);
    expect(stored!.rating).toBe(4);
    const after = await hotels.findById(hotelId).lean();
    expect(after!.ratingAvg).toBe(before!.ratingAvg);
    expect(after!.ratingCount).toBe(before!.ratingCount);

    const list = await http().get(`/api/hotels/${hotelId}/reviews`).expect(200);
    const item = list.body.items.find((r: { id: string }) => r.id === id);
    expect(item.reply).toMatchObject({ text: 'We hope to see you.' });
    expect(item.reply).not.toHaveProperty('moderatorId');
  });

  it('leaves reviews without a reply unchanged in the public list', async () => {
    const id = await newReview({ text: 'No answer yet' });
    const list = await http().get(`/api/hotels/${hotelId}/reviews`).expect(200);
    const item = list.body.items.find((r: { id: string }) => r.id === id);
    expect(item).toBeDefined();
    expect(item).not.toHaveProperty('reply');
  });

  it('rejects the moderator of another hotel (403) and writes nothing', async () => {
    const id = await newReview();
    const res = await reply(id, otherModerator, { text: 'Hi' }).expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect((await reviews.findById(id).lean())!.reply).toBeUndefined();
  });

  it('rejects travellers and admins (403) and anonymous callers (401)', async () => {
    const id = await newReview();
    await reply(id, traveller, { text: 'Hi' }).expect(403);
    await reply(id, null, { text: 'Hi' })
      .set('x-dev-user', 'ADMIN')
      .expect(403);
    await reply(id, null, { text: 'Hi' }).expect(401);
  });

  it('404 for an unknown review, 400 for a malformed id', async () => {
    const res = await reply(new Types.ObjectId().toHexString(), moderator, {
      text: 'Hi',
    }).expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    await reply('not-an-id', moderator, { text: 'Hi' }).expect(400);
  });

  it('409 REVIEW_HIDDEN for a review hidden by an admin', async () => {
    const id = await newReview({ isHidden: true });
    const res = await reply(id, moderator, { text: 'Hi' }).expect(409);
    expect(res.body.code).toBe('REVIEW_HIDDEN');
    expect((await reviews.findById(id).lean())!.reply).toBeUndefined();
  });

  it('400 for an empty, blank, missing, non-string or over-long text', async () => {
    const id = await newReview();
    await reply(id, moderator, { text: '' }).expect(400);
    await reply(id, moderator, { text: '   ' }).expect(400);
    await reply(id, moderator, {}).expect(400);
    await reply(id, moderator, { text: 5 }).expect(400);
    await reply(id, moderator, { text: 'x'.repeat(1001) }).expect(400);
    await reply(id, moderator, { text: 'x'.repeat(1000) }).expect(200);
  });

  it('records the reply in the audit log', async () => {
    const id = await newReview();
    await reply(id, moderator, { text: 'Audited' }).expect(200);
    const log = await http()
      .get('/api/admin/audit-logs?action=REPLY_REVIEW')
      .set('x-dev-user', 'ADMIN')
      .expect(200);
    expect(log.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'REPLY_REVIEW',
          targetType: 'REVIEW',
          targetId: id,
        }),
      ]),
    );
  });
});

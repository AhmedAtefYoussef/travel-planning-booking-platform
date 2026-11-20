import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { Review } from '../src/modules/hotels';
import { Report } from '../src/modules/moderation';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/**
 * GEN-09: a registered user reports a hotel review through the real hotels adapter, at most once.
 * The reviews are rows written through the model (the HTL-23 flow is covered by hotel-reviews).
 */
describe('Review reports (e2e): GEN-09 report a hotel review once', () => {
  let app: INestApplication<App>;
  let reviews: Model<Review>;
  let reports: Model<Report>;
  let guest: LoggedIn;
  let stranger: LoggedIn;
  let other: LoggedIn;

  const report = (as: LoggedIn, targetId: string, reason = 'Fake review') =>
    request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', as.cookie)
      .send({ targetType: 'REVIEW', targetId, reason });

  const review = async (isHidden = false): Promise<string> => {
    const created = await reviews.create({
      hotelId: new Types.ObjectId(),
      reservationId: new Types.ObjectId(),
      userId: new Types.ObjectId(guest.userId),
      rating: 1,
      text: 'Not what the photos showed',
      isHidden,
    });
    return created._id.toHexString();
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    reviews = app.get<Model<Review>>(getModelToken(Review.name));
    reports = app.get<Model<Report>>(getModelToken(Report.name));
    await reports.syncIndexes();
    guest = await loginAs(app, Role.User);
    stranger = await loginAs(app, Role.User);
    other = await loginAs(app, Role.User);
  });

  afterAll(async () => {
    await app.close();
  });

  it('files an OPEN report of a review (201), a second one by the same user is a 409', async () => {
    const id = await review();
    const res = await report(stranger, id).expect(201);
    expect(res.body).toMatchObject({
      targetType: 'REVIEW',
      targetId: id,
      reason: 'Fake review',
      status: 'OPEN',
    });
    const again = await report(stranger, id, 'Again').expect(409);
    expect(again.body.code).toBe('REPORT_ALREADY_FILED');
    await report(other, id).expect(201);
    expect(
      await reports.countDocuments({ targetId: new Types.ObjectId(id) }),
    ).toBe(2);
  });

  it('keeps one report when five identical requests arrive at once', async () => {
    const id = await review();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => report(stranger, id)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([
      201, 409, 409, 409, 409,
    ]);
  });

  it('answers 404 for a hidden review to a stranger, while its author may report it', async () => {
    const id = await review(true);
    const hidden = await report(stranger, id).expect(404);
    const unknown = await report(
      stranger,
      new Types.ObjectId().toHexString(),
    ).expect(404);
    expect(hidden.body.message).toBe(unknown.body.message);
    await report(guest, id).expect(201);
  });

  it('answers 404 for an unknown review', async () => {
    const res = await report(
      stranger,
      new Types.ObjectId().toHexString(),
    ).expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

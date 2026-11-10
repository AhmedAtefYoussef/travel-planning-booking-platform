import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { UPLOAD_LIMITS } from '../src/common/contracts';
import { createTestApp } from './support/create-test-app';

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const png = (extraBytes = 32) =>
  Buffer.concat([PNG_HEADER, Buffer.alloc(extraBytes, 7)]);
const jpeg = () =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 7)]);

/** GEN-08 through its first consumer, the airline logo (FLT-01). */
describe('Image uploads (e2e): GEN-08, FLT-01 logo', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const uploadDir = resolve(process.env.UPLOAD_DIR as string);
  const logoFiles = () =>
    existsSync(join(uploadDir, 'airlines'))
      ? readdirSync(join(uploadDir, 'airlines'))
      : [];

  let airlineId: string;
  let moderator: string;
  const outsider = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${new Types.ObjectId().toHexString()}`;

  beforeAll(async () => {
    rmSync(uploadDir, { recursive: true, force: true });
    app = await createTestApp();
    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Upload Test Air', code: 'UP' })
      .expect(201);
    airlineId = airline.body.id as string;
    moderator = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airlineId}`;
  });

  afterAll(async () => {
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  const upload = (
    as: string | null,
    buffer: Buffer,
    filename = 'logo.png',
    contentType = 'image/png',
  ) => {
    const req = http().put(`/api/airlines/${airlineId}/logo`);
    if (as) void req.set('x-dev-user', as);
    return req.attach('file', buffer, { filename, contentType });
  };

  it('the moderator uploads a PNG logo; it is stored and served by URL', async () => {
    const res = await upload(moderator, png()).expect(200);
    expect(res.body.logoUrl).toMatch(
      new RegExp(`^/uploads/airlines/${airlineId}-[a-f0-9-]{36}\\.png$`),
    );
    expect(logoFiles()).toHaveLength(1);

    const served = await http()
      .get(res.body.logoUrl as string)
      .expect(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['content-security-policy']).toBe(
      "default-src 'none'",
    );
    expect(Buffer.compare(served.body as Buffer, png())).toBe(0);

    const profile = await http().get(`/api/airlines/${airlineId}`).expect(200);
    expect(profile.body.logoUrl).toBe(res.body.logoUrl);
  });

  it('an airline has one logo: a new JPG replaces the PNG and the old file is deleted', async () => {
    const before = (await http().get(`/api/airlines/${airlineId}`)).body
      .logoUrl as string;
    const res = await upload(
      moderator,
      jpeg(),
      'logo.jpg',
      'image/jpeg',
    ).expect(200);
    expect(res.body.logoUrl).toMatch(/\.jpg$/);
    expect(res.body.logoUrl).not.toBe(before);
    expect(logoFiles()).toEqual([
      (res.body.logoUrl as string).split('/').pop(),
    ]);
    await http().get(before).expect(404);
    const served = await http()
      .get(res.body.logoUrl as string)
      .expect(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
  });

  it('rejects a file that is not a JPG or PNG, whatever its name says, and keeps the current logo', async () => {
    const current = (await http().get(`/api/airlines/${airlineId}`)).body
      .logoUrl as string;
    const res = await upload(
      moderator,
      Buffer.from('<html><script>alert(1)</script></html>'),
      'logo.png',
      'image/png',
    ).expect(400);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [
        { field: 'files[0]', message: 'Only JPG and PNG images are accepted' },
      ],
    });
    for (const [name, type, body] of [
      ['anim.gif', 'image/gif', Buffer.from('GIF89a..........')],
      ['doc.pdf', 'application/pdf', Buffer.from('%PDF-1.7 .......')],
      ['icon.svg', 'image/svg+xml', Buffer.from('<svg/>')],
    ] as const) {
      await upload(moderator, body, name, type).expect(400);
    }
    const after = await http().get(`/api/airlines/${airlineId}`).expect(200);
    expect(after.body.logoUrl).toBe(current);
    expect(logoFiles()).toHaveLength(1);
  });

  it('accepts exactly 5 MB and rejects a larger file with 413', async () => {
    const atLimit = png(UPLOAD_LIMITS.maxBytes - PNG_HEADER.length);
    await upload(moderator, atLimit).expect(200);
    const res = await upload(moderator, png(UPLOAD_LIMITS.maxBytes)).expect(
      413,
    );
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(logoFiles()).toHaveLength(1);
  });

  it('rejects a request without a file, or with an empty one, with a field error', async () => {
    const missing = await http()
      .put(`/api/airlines/${airlineId}/logo`)
      .set('x-dev-user', moderator)
      .expect(400);
    expect(missing.body.fieldErrors).toEqual([
      {
        field: 'file',
        message: 'Attach the logo as a JPG or PNG image in the "file" field',
      },
    ]);
    const empty = await upload(moderator, Buffer.alloc(0)).expect(400);
    expect(empty.body.fieldErrors).toEqual([
      { field: 'files[0]', message: 'The file is empty' },
    ]);
  });

  it('only the moderator of this airline may upload or remove the logo', async () => {
    await upload(null, png()).expect(401);
    await upload('USER', png()).expect(403);
    await upload('ADMIN', png()).expect(403);
    await upload(outsider, png()).expect(403);
    await http()
      .delete(`/api/airlines/${airlineId}/logo`)
      .set('x-dev-user', outsider)
      .expect(403);
    expect(logoFiles()).toHaveLength(1);
  });

  it('answers 404 for an unknown airline and 400 for a malformed id', async () => {
    const unknown = new Types.ObjectId().toHexString();
    await http()
      .put(`/api/airlines/${unknown}/logo`)
      .set('x-dev-user', `AIRLINE_MODERATOR:${unknown}:${unknown}`)
      .attach('file', png(), 'logo.png')
      .expect(404);
    await http()
      .put('/api/airlines/not-an-id/logo')
      .set('x-dev-user', moderator)
      .attach('file', png(), 'logo.png')
      .expect(400);
  });

  it('serves only stored files: no directory listing and no path traversal', async () => {
    await http().get('/uploads/').expect(404);
    await http().get('/uploads/airlines/').expect(404);
    await http().get('/uploads/airlines/missing.png').expect(404);
    await http().get('/uploads/..%2f..%2fpackage.json').expect(404);
    await http()
      .get('/uploads/airlines/..%2f..%2f..%2fpackage.json')
      .expect(404);
  });

  it('the moderator removes the logo: the field is cleared and the file is deleted', async () => {
    const before = (await http().get(`/api/airlines/${airlineId}`)).body
      .logoUrl as string;
    const res = await http()
      .delete(`/api/airlines/${airlineId}/logo`)
      .set('x-dev-user', moderator)
      .expect(200);
    expect(res.body.logoUrl).toBeNull();
    expect(logoFiles()).toHaveLength(0);
    await http().get(before).expect(404);
    // Removing again changes nothing.
    await http()
      .delete(`/api/airlines/${airlineId}/logo`)
      .set('x-dev-user', moderator)
      .expect(200);
  });

  it('replacing an uploaded logo with a link through PATCH also deletes the stored file', async () => {
    await upload(moderator, png()).expect(200);
    expect(logoFiles()).toHaveLength(1);
    const res = await http()
      .patch(`/api/airlines/${airlineId}`)
      .set('x-dev-user', moderator)
      .send({ logoUrl: 'https://cdn.example.com/logo.png' })
      .expect(200);
    expect(res.body.logoUrl).toBe('https://cdn.example.com/logo.png');
    expect(logoFiles()).toHaveLength(0);
  });
});

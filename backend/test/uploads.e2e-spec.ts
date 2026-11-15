// Must be the first import: it points UPLOAD_DIR at a fresh temp folder before AppModule is loaded.
import {
  removeTempUploadDir,
  TEMP_UPLOAD_DIR,
} from './support/temp-upload-dir';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Hotel } from '../src/modules/hotels';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');
const MB = 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff, 0xe0];

/** A small buffer that starts with an image signature (enough for the magic-byte check). */
function img(signature: number[], size = 128, fill = 0): Buffer {
  const buf = Buffer.alloc(size, fill);
  Buffer.from(signature).copy(buf);
  return buf;
}
const png = (fill = 1, size = 128) => img(PNG_SIGNATURE, size, fill);
const jpeg = (fill = 2) => img(JPEG_SIGNATURE, 128, fill);

const UUID =
  '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const HOTEL_URL = new RegExp(`^/uploads/hotels/${UUID}\\.(png|jpg)$`);
const AIRLINE_URL = new RegExp(`^/uploads/airlines/${UUID}\\.(png|jpg)$`);

const fieldsOf = (res: request.Response): string[] =>
  ((res.body.fieldErrors ?? []) as { field: string }[]).map((e) => e.field);

/** File names currently stored in one upload folder. */
const filesIn = (folder: string): string[] => {
  const dir = join(TEMP_UPLOAD_DIR, folder);
  return existsSync(dir) ? readdirSync(dir).sort() : [];
};
const fileOf = (url: string) => url.split('/').pop() as string;
const onDisk = (url: string) =>
  existsSync(join(TEMP_UPLOAD_DIR, ...url.split('/').slice(2)));

describe('Image uploads (e2e): GEN-08', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const hotels = () => app.get<Model<Hotel>>(getModelToken(Hotel.name));
  const admin = 'ADMIN';
  const hotelModeratorOf = (hotelId: string) =>
    `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
  const airlineModeratorOf = (airlineId: string) =>
    `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airlineId}`;

  async function newHotel(): Promise<string> {
    const res = await http()
      .post('/api/hotels')
      .set('x-dev-user', admin)
      .send({
        name: 'Upload Inn',
        address: '1 Corniche El Nil',
        cityId: 'cairo',
      })
      .expect(201);
    return res.body.id as string;
  }

  let codeSeq = 0;
  async function newAirline(): Promise<string> {
    codeSeq += 1;
    const res = await http()
      .post('/api/airlines')
      .set('x-dev-user', admin)
      .send({ name: 'Upload Air', code: `U${codeSeq}` })
      .expect(201);
    return res.body.id as string;
  }

  const uploadHotel = (hotelId: string, user: string, files: Buffer[]) => {
    let req = http()
      .post(`/api/hotels/${hotelId}/images`)
      .set('x-dev-user', user);
    files.forEach((buf, i) => {
      const isPng = buf[0] === 0x89;
      req = req.attach('images', buf, {
        filename: `photo-${i}.${isPng ? 'png' : 'jpg'}`,
        contentType: isPng ? 'image/png' : 'image/jpeg',
      });
    });
    return req;
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
  });

  afterAll(async () => {
    await app.close();
    removeTempUploadDir();
  });

  describe('POST /api/hotels/:id/images', () => {
    it('GEN-08 hotel moderator uploads 2 PNGs and they are served with image/png and nosniff', async () => {
      const hotelId = await newHotel();
      const first = png(7);
      const second = png(9);
      const res = await uploadHotel(hotelId, hotelModeratorOf(hotelId), [
        first,
        second,
      ]).expect(201);
      expect(res.body.id).toBe(hotelId);
      expect(res.body.photos).toHaveLength(2);
      for (const url of res.body.photos as string[]) {
        expect(url).toMatch(HOTEL_URL);
        expect(url).not.toContain('photo-');
        expect(onDisk(url)).toBe(true);
      }

      // Served outside the /api prefix, with the stored bytes and safe headers.
      const served = await http()
        .get(res.body.photos[0])
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(served.headers['content-type']).toBe('image/png');
      expect(served.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.compare(served.body as Buffer, first)).toBe(0);

      // No directory listing, no dotfiles, and nothing under /api/uploads.
      await http().get('/uploads/').expect(404);
      await http().get('/uploads/hotels/').expect(404);
      const dot = await http().get('/uploads/hotels/.env');
      expect([403, 404]).toContain(dot.status);
      await http()
        .get(`/api${res.body.photos[0] as string}`)
        .expect(404);
    });

    it('an admin may upload too, and JPEG is accepted', async () => {
      const hotelId = await newHotel();
      const res = await uploadHotel(hotelId, admin, [jpeg()]).expect(201);
      expect(res.body.photos[0]).toMatch(/\.jpg$/);
      const served = await http().get(res.body.photos[0]).expect(200);
      expect(served.headers['content-type']).toBe('image/jpeg');
    });

    it('GEN-08 text renamed .png is 400', async () => {
      const hotelId = await newHotel();
      const before = filesIn('hotels');
      const res = await http()
        .post(`/api/hotels/${hotelId}/images`)
        .set('x-dev-user', hotelModeratorOf(hotelId))
        .attach('images', Buffer.from('this is plain text, not a picture'), {
          filename: 'holiday.png',
          contentType: 'image/png',
        })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(fieldsOf(res)).toEqual(['images']);
      expect(filesIn('hotels')).toEqual(before);
      expect((await hotels().findById(hotelId).lean())?.photos).toEqual([]);
    });

    it('rejects a file above 5 MB, a sixth image and an empty request with 400 fieldErrors.images', async () => {
      const hotelId = await newHotel();
      const mod = hotelModeratorOf(hotelId);
      const big = await uploadHotel(hotelId, mod, [png(1, 5 * MB + 1)]).expect(
        400,
      );
      expect(fieldsOf(big)).toEqual(['images']);

      const six = await uploadHotel(
        hotelId,
        mod,
        [1, 2, 3, 4, 5, 6].map((n) => png(n)),
      ).expect(400);
      expect(fieldsOf(six)).toEqual(['images']);

      const none = await http()
        .post(`/api/hotels/${hotelId}/images`)
        .set('x-dev-user', mod)
        .field('note', 'no files')
        .expect(400);
      expect(fieldsOf(none)).toEqual(['images']);

      await uploadHotel(
        hotelId,
        mod,
        [1, 2, 3, 4, 5].map((n) => png(n)),
      ).expect(201);
      const sixth = await uploadHotel(hotelId, mod, [png(6)]).expect(400);
      expect(fieldsOf(sixth)).toEqual(['images']);
    });

    it('exactly 5 MB is accepted', async () => {
      const hotelId = await newHotel();
      await uploadHotel(hotelId, admin, [png(1, 5 * MB)]).expect(201);
    });

    it("GEN-08 concurrent uploads never exceed 5 photos and the loser's files are removed", async () => {
      const hotelId = await newHotel();
      const mod = hotelModeratorOf(hotelId);
      await uploadHotel(hotelId, mod, [png(1), png(2), png(3)]).expect(201);
      const before = filesIn('hotels');

      const results = await Promise.all([
        uploadHotel(hotelId, mod, [png(4), png(5)]),
        uploadHotel(hotelId, mod, [png(6), png(7)]),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
      const loser = results.find((r) => r.status === 400) as request.Response;
      expect(fieldsOf(loser)).toEqual(['images']);

      const winner = results.find((r) => r.status === 201) as request.Response;
      const photos = winner.body.photos as string[];
      expect(photos).toHaveLength(5);
      // Only the winner's two files were added to the disk; the loser left nothing behind.
      const added = filesIn('hotels').filter((f) => !before.includes(f));
      expect(added.sort()).toEqual(photos.slice(3).map(fileOf).sort());
    });

    it("GEN-08 other hotel's moderator 403, guest 401", async () => {
      const hotelId = await newHotel();
      const otherHotel = await newHotel();
      const before = filesIn('hotels');
      const forbidden = await uploadHotel(
        hotelId,
        hotelModeratorOf(otherHotel),
        [png()],
      ).expect(403);
      expect(forbidden.body.code).toBe('FORBIDDEN');
      await http()
        .post(`/api/hotels/${hotelId}/images`)
        .attach('images', png(), {
          filename: 'a.png',
          contentType: 'image/png',
        })
        .expect(401);
      const traveller = await uploadHotel(
        hotelId,
        `USER:${new Types.ObjectId().toHexString()}`,
        [png()],
      );
      expect(traveller.status).toBe(403);
      expect(filesIn('hotels')).toEqual(before);
    });

    it('an unknown hotel is 404 and a malformed id is 400', async () => {
      const missing = new Types.ObjectId().toHexString();
      await uploadHotel(missing, admin, [png()]).expect(404);
      await uploadHotel('not-an-id', admin, [png()]).expect(400);
    });
  });

  describe('DELETE /api/hotels/:id/images/:imageId', () => {
    it('removes the image from photos and from disk', async () => {
      const hotelId = await newHotel();
      const mod = hotelModeratorOf(hotelId);
      const up = await uploadHotel(hotelId, mod, [png(1), png(2)]).expect(201);
      const [gone, kept] = up.body.photos as string[];
      const imageId = fileOf(gone).split('.')[0];

      const res = await http()
        .delete(`/api/hotels/${hotelId}/images/${imageId}`)
        .set('x-dev-user', mod)
        .expect(200);
      expect(res.body.photos).toEqual([kept]);
      expect(onDisk(gone)).toBe(false);
      expect(onDisk(kept)).toBe(true);
      await http().get(gone).expect(404);

      const again = await http()
        .delete(`/api/hotels/${hotelId}/images/${imageId}`)
        .set('x-dev-user', mod)
        .expect(404);
      expect(again.body.code).toBe('NOT_FOUND');
    });

    it("rejects a malformed image id with 400 and another hotel's moderator with 403", async () => {
      const hotelId = await newHotel();
      const up = await uploadHotel(hotelId, admin, [png()]).expect(201);
      const imageId = fileOf(up.body.photos[0]).split('.')[0];
      const bad = await http()
        .delete(`/api/hotels/${hotelId}/images/..%2F..%2Fsecret`)
        .set('x-dev-user', admin)
        .expect(400);
      expect(fieldsOf(bad)).toEqual(['imageId']);
      await http()
        .delete(`/api/hotels/${hotelId}/images/${imageId}`)
        .set('x-dev-user', hotelModeratorOf(await newHotel()))
        .expect(403);
      expect(onDisk(up.body.photos[0])).toBe(true);
    });

    it('keeps the file while another hotel still lists the same URL', async () => {
      const a = await newHotel();
      const b = await newHotel();
      const up = await uploadHotel(a, admin, [png()]).expect(201);
      const url = up.body.photos[0] as string;
      await http()
        .patch(`/api/hotels/${b}`)
        .set('x-dev-user', hotelModeratorOf(b))
        .send({ photos: [url] })
        .expect(200);
      await http()
        .delete(`/api/hotels/${b}/images/${fileOf(url).split('.')[0]}`)
        .set('x-dev-user', admin)
        .expect(200);
      expect(onDisk(url)).toBe(true);
    });
  });

  describe('HTL-01 PATCH photos still accepts links, and now local upload URLs', () => {
    it('accepts http(s) and /uploads/hotels/<uuid>.png; rejects other local paths', async () => {
      const hotelId = await newHotel();
      const mod = hotelModeratorOf(hotelId);
      const local = '/uploads/hotels/3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e.png';
      const ok = await http()
        .patch(`/api/hotels/${hotelId}`)
        .set('x-dev-user', mod)
        .send({ photos: ['https://cdn.example.com/a.jpg', local] })
        .expect(200);
      expect(ok.body.photos).toEqual(['https://cdn.example.com/a.jpg', local]);
      for (const photo of [
        '/uploads/airlines/3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e.png',
        '/uploads/hotels/../secret.png',
        '/uploads/hotels/a.png',
      ]) {
        const res = await http()
          .patch(`/api/hotels/${hotelId}`)
          .set('x-dev-user', mod)
          .send({ photos: [photo] })
          .expect(400);
        expect(fieldsOf(res)).toEqual(['photos']);
      }
    });
  });

  describe('PUT /api/airlines/:id/logo', () => {
    const putLogo = (airlineId: string, user: string, files: Buffer[]) => {
      let req = http()
        .put(`/api/airlines/${airlineId}/logo`)
        .set('x-dev-user', user);
      files.forEach((buf, i) => {
        req = req.attach('logo', buf, {
          filename: `logo-${i}.png`,
          contentType: 'image/png',
        });
      });
      return req;
    };

    it('GEN-08 airline logo replace removes the old file; second file in one request 400', async () => {
      const airlineId = await newAirline();
      const mod = airlineModeratorOf(airlineId);

      const first = await putLogo(airlineId, mod, [png(1)]).expect(200);
      expect(first.body.logoUrl).toMatch(AIRLINE_URL);
      expect(onDisk(first.body.logoUrl)).toBe(true);
      const served = await http().get(first.body.logoUrl).expect(200);
      expect(served.headers['content-type']).toBe('image/png');
      expect(served.headers['x-content-type-options']).toBe('nosniff');

      const second = await putLogo(airlineId, mod, [png(2)]).expect(200);
      expect(second.body.logoUrl).toMatch(AIRLINE_URL);
      expect(second.body.logoUrl).not.toBe(first.body.logoUrl);
      expect(onDisk(first.body.logoUrl)).toBe(false);
      expect(onDisk(second.body.logoUrl)).toBe(true);
      await http().get(first.body.logoUrl).expect(404);

      const before = filesIn('airlines');
      const two = await putLogo(airlineId, mod, [png(3), png(4)]).expect(400);
      expect(two.body.code).toBe('VALIDATION_FAILED');
      expect(fieldsOf(two)).toEqual(['logo']);
      expect(filesIn('airlines')).toEqual(before);
      const view = await http().get(`/api/airlines/${airlineId}`).expect(200);
      expect(view.body.logoUrl).toBe(second.body.logoUrl);
    });

    it('an admin may set the logo; text sent as PNG, no file, other airline 403, guest 401', async () => {
      const airlineId = await newAirline();
      await putLogo(airlineId, admin, [png()]).expect(200);
      const before = filesIn('airlines');

      const text = await http()
        .put(`/api/airlines/${airlineId}/logo`)
        .set('x-dev-user', admin)
        .attach('logo', Buffer.from('not an image'), {
          filename: 'l.png',
          contentType: 'image/png',
        })
        .expect(400);
      expect(fieldsOf(text)).toEqual(['logo']);
      const none = await http()
        .put(`/api/airlines/${airlineId}/logo`)
        .set('x-dev-user', admin)
        .expect(400);
      expect(fieldsOf(none)).toEqual(['logo']);
      await putLogo(airlineId, airlineModeratorOf(await newAirline()), [
        png(),
      ]).expect(403);
      await http()
        .put(`/api/airlines/${airlineId}/logo`)
        .attach('logo', png(), { filename: 'l.png', contentType: 'image/png' })
        .expect(401);
      await putLogo(new Types.ObjectId().toHexString(), admin, [png()]).expect(
        404,
      );
      expect(filesIn('airlines')).toEqual(before);
    });

    it('replacing an http(s) logo leaves the link alone; PATCH accepts the local URL', async () => {
      const res = await http()
        .post('/api/airlines')
        .set('x-dev-user', admin)
        .send({
          name: 'Linked Air',
          code: 'LK9',
          logoUrl: 'https://cdn.example.com/lk.png',
        })
        .expect(201);
      const mod = airlineModeratorOf(res.body.id);
      const up = await putLogo(res.body.id, mod, [png()]).expect(200);
      await http()
        .patch(`/api/airlines/${res.body.id}`)
        .set('x-dev-user', mod)
        .send({ logoUrl: up.body.logoUrl })
        .expect(200);
      const bad = await http()
        .patch(`/api/airlines/${res.body.id}`)
        .set('x-dev-user', mod)
        .send({ logoUrl: up.body.logoUrl.replace('/airlines/', '/hotels/') })
        .expect(400);
      expect(fieldsOf(bad)).toEqual(['logoUrl']);
    });
  });
});

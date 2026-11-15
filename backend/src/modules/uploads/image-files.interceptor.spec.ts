import {
  Controller,
  INestApplication,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import type { UploadedFileLike } from '../../common/contracts/services.contract';
import { ImageFilesInterceptor } from './image-files.interceptor';

const MB = 1024 * 1024;

@Controller('probe')
class ProbeController {
  @Post('images')
  @UseInterceptors(ImageFilesInterceptor('images', 2))
  images(@UploadedFiles() files: UploadedFileLike[] | undefined) {
    return (files ?? []).map((f) => ({
      size: f.size,
      bytes: f.buffer.length,
      mimetype: f.mimetype,
    }));
  }
}

describe('ImageFilesInterceptor (GEN-08)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps the files in memory and passes them to the handler', async () => {
    const res = await http()
      .post('/probe/images')
      .attach('images', Buffer.from('abc'), {
        filename: 'a.png',
        contentType: 'image/png',
      })
      .expect(201);
    expect(res.body).toEqual([{ size: 3, bytes: 3, mimetype: 'image/png' }]);
  });

  it('exactly 5 MB passes the multer limit', async () => {
    await http()
      .post('/probe/images')
      .attach('images', Buffer.alloc(5 * MB), 'a.png')
      .expect(201);
  });

  it.each([
    [
      'a file above 5 MB',
      (r: request.Test) =>
        r.attach('images', Buffer.alloc(5 * MB + 1), 'big.png'),
    ],
    [
      'more files than allowed',
      (r: request.Test) =>
        r
          .attach('images', Buffer.from('1'), 'a.png')
          .attach('images', Buffer.from('2'), 'b.png')
          .attach('images', Buffer.from('3'), 'c.png'),
    ],
    [
      'a file under another field name',
      (r: request.Test) => r.attach('other', Buffer.from('1'), 'a.png'),
    ],
  ])('%s is a 400 with fieldErrors on the field', async (_label, build) => {
    const res = await build(http().post('/probe/images')).expect(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(res.body.fieldErrors).toEqual([
      { field: 'images', message: expect.any(String) },
    ]);
  });

  it('a malformed multipart body is a 400', async () => {
    const res = await http()
      .post('/probe/images')
      .set('Content-Type', 'multipart/form-data; boundary=xyz')
      .send('--xyz\r\nContent-Disposition: form-data; name="images"')
      .expect(400);
    expect(res.body).toMatchObject({ code: 'BAD_REQUEST' });
  });
});

import {
  Body,
  Controller,
  Get,
  INestApplication,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsString, MinLength } from 'class-validator';
import type { Request } from 'express';
import request from 'supertest';

interface Body {
  fieldErrors: { field: string }[];
  raw: string;
  openapi: string;
}
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { setupApp } from './setup-app';

class CreateDto {
  @IsString()
  @MinLength(3)
  name!: string;
}

@Controller('probe')
class ProbeController {
  @Post()
  create(@Body() dto: CreateDto) {
    return dto;
  }

  @Get('item/:id')
  item(@Param('id', ParseObjectIdPipe) id: string) {
    return { id };
  }

  @Get('cookies')
  cookies(@Req() req: Request) {
    return req.cookies;
  }

  @Post('raw')
  raw(@Req() req: Request & { rawBody?: Buffer }) {
    return { raw: req.rawBody?.toString('utf8') };
  }
}

describe('setupApp', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    setupApp(app);
    await app.init();
  });

  afterAll(() => app.close());

  it('returns the standard error shape with fieldErrors', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/probe')
      .send({ name: 'x', extra: 1 })
      .expect(400);
    expect(res.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      path: '/api/probe',
    });
    const body = res.body as Body;
    const fields = body.fieldErrors.map((f) => f.field);
    expect(fields.sort()).toEqual(['extra', 'name']);
  });

  it('400 on bad ObjectId, 200 on good one', async () => {
    await request(app.getHttpServer()).get('/api/probe/item/nope').expect(400);
    await request(app.getHttpServer())
      .get('/api/probe/item/507f1f77bcf86cd799439011')
      .expect(200);
  });

  it('parses cookies', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/probe/cookies')
      .set('Cookie', 'refresh=abc')
      .expect(200);
    expect(res.body).toEqual({ refresh: 'abc' });
  });

  it('exposes rawBody', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/probe/raw')
      .set('Content-Type', 'application/json')
      .send('{"a":1}')
      .expect(201);
    expect((res.body as Body).raw).toBe('{"a":1}');
  });

  it('serves swagger json and UI', async () => {
    const json = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect((json.body as Body).openapi).toBeDefined();
    await request(app.getHttpServer()).get('/api/docs').expect(200);
  });
});

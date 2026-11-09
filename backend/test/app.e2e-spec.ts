import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PAYABLE_BOOKING } from '../src/common/contracts';
import { CurrentUser, Public } from '../src/common/decorators';
import { PayableBookingStub } from '../src/common/stubs';

@Controller('probe')
class ProbeController {
  @Public()
  @Get('open')
  open() {
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser('id') id: string) {
    return { id };
  }
}

describe('App skeleton (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves @Public routes under /api', async () => {
    await request(app.getHttpServer()).get('/api/probe/open').expect(200);
    await request(app.getHttpServer()).get('/probe/open').expect(404);
  });

  it('denies protected routes by default', async () => {
    await request(app.getHttpServer()).get('/api/probe/me').expect(401);
  });

  it('accepts a dev user outside production', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/probe/me')
      .set('x-dev-user-id', 'user-1')
      .expect(200);
    expect(res.body).toEqual({ id: 'user-1' });
  });

  it('binds contract tokens to stubs', () => {
    expect(app.get(PAYABLE_BOOKING)).toBeInstanceOf(PayableBookingStub);
  });
});

/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DevAuthGuard } from '../../common/guards/dev-auth.guard';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

describe('AuditController', () => {
  let app: INestApplication;
  const list = jest.fn().mockResolvedValue({
    items: [],
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [() => ({ DEV_AUTH_ENABLED: true, NODE_ENV: 'test' })],
        }),
      ],
      controllers: [AuditController],
      providers: [
        { provide: AuditService, useValue: { list } },
        { provide: APP_GUARD, useClass: DevAuthGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });
  afterAll(() => app.close());

  it('rejects non-admin users with 403', async () => {
    await request(app.getHttpServer())
      .get('/admin/audit-logs')
      .set('x-dev-user-id', 'u1')
      .set('x-dev-role', 'USER')
      .expect(403);
  });

  it('rejects anonymous callers with 401', async () => {
    await request(app.getHttpServer()).get('/admin/audit-logs').expect(401);
  });

  it('lets an admin list with filters', async () => {
    await request(app.getHttpServer())
      .get('/admin/audit-logs?actorId=u1&action=A&from=2026-01-01&page=2')
      .set('x-dev-user-id', 'a1')
      .set('x-dev-role', 'ADMIN')
      .expect(200);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'u1', action: 'A', page: 2 }),
    );
  });

  it('rejects an invalid date filter with 400', async () => {
    await request(app.getHttpServer())
      .get('/admin/audit-logs?from=notadate')
      .set('x-dev-user-id', 'a1')
      .set('x-dev-role', 'ADMIN')
      .expect(400);
  });

  it('exposes no mutating routes', () => {
    expect(Object.getOwnPropertyNames(AuditController.prototype)).toEqual([
      'constructor',
      'list',
    ]);
  });
});

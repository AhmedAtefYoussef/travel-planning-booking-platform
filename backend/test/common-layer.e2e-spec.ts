import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './support/create-test-app';
import { ProbeModule } from './support/probe.module';

const passengers = [{ fullName: 'Ada Lovelace', dob: '1990-12-10' }];

describe('Common layer (e2e): GEN-02, GEN-05, GEN-13, TRVL-130', () => {
  let app: INestApplication<App>;
  let http: () => ReturnType<typeof request>;

  beforeAll(async () => {
    app = await createTestApp([ProbeModule]);
    http = () => request(app.getHttpServer());
    const model = app.get<Model<unknown>>(getModelToken(ProbeModule.model));
    await model.deleteMany({});
    await model.syncIndexes();
  });

  afterAll(async () => {
    await app.close();
  });

  const expectErrorShape = (
    body: Record<string, unknown>,
    status: number,
    code: string,
  ) => {
    expect(body).toMatchObject({
      statusCode: status,
      code,
      path: expect.any(String),
    });
    expect(typeof body.error).toBe('string');
    expect(typeof body.message).toBe('string');
    expect(new Date(body.timestamp as string).toISOString()).toBe(
      body.timestamp,
    );
    expect(body).not.toHaveProperty('stack');
  };

  describe('validation (GEN-02, GEN-13)', () => {
    it('returns 400 with dotted fieldErrors for nested DTO failures', async () => {
      const res = await http()
        .post('/api/__probe/items')
        .send({
          name: 'x',
          email: 'not-an-email',
          passengers: [{ fullName: '', dob: '12/10/1990' }],
        })
        .expect(400);
      expectErrorShape(res.body, 400, 'VALIDATION_FAILED');
      const fields = (res.body.fieldErrors as { field: string }[]).map(
        (f) => f.field,
      );
      expect(fields).toEqual(
        expect.arrayContaining([
          'name',
          'email',
          'passengers[0].fullName',
          'passengers[0].dob',
        ]),
      );
    });

    it('rejects properties that are not in the DTO instead of silently dropping them', async () => {
      const res = await http()
        .post('/api/__probe/items')
        .send({ name: 'Valid', email: 'a@b.co', passengers, role: 'ADMIN' })
        .expect(400);
      expect(res.body.fieldErrors).toEqual([
        { field: 'role', message: 'property role should not exist' },
      ]);
    });

    it('returns 400 for a malformed JSON body', async () => {
      const res = await http()
        .post('/api/__probe/items')
        .set('Content-Type', 'application/json')
        .send('{"name": ')
        .expect(400);
      expectErrorShape(res.body, 400, 'BAD_REQUEST');
    });
  });

  describe('persistence errors', () => {
    it('maps a Mongo duplicate key to 409 with the conflicting field', async () => {
      const body = { name: 'First', email: 'dup@example.com', passengers };
      await http().post('/api/__probe/items').send(body).expect(201);
      const res = await http()
        .post('/api/__probe/items')
        .send(body)
        .expect(409);
      expectErrorShape(res.body, 409, 'DUPLICATE_KEY');
      expect(res.body.fieldErrors).toEqual([
        { field: 'email', message: 'email already exists' },
      ]);
    });

    it('rejects a malformed id at the pipe with 400 INVALID_ID', async () => {
      const res = await http().get('/api/__probe/items/not-an-id').expect(400);
      expectErrorShape(res.body, 400, 'INVALID_ID');
      expect(res.body.fieldErrors[0].field).toBe('id');
    });

    it('maps a Mongoose CastError to 400 when no pipe guarded the id', async () => {
      const res = await http().get('/api/__probe/cast/xyz').expect(400);
      expectErrorShape(res.body, 400, 'INVALID_ID');
    });

    it('returns 404 in the standard shape', async () => {
      const res = await http()
        .get('/api/__probe/items/0123456789abcdef01234567')
        .expect(404);
      expectErrorShape(res.body, 404, 'NOT_FOUND');
      expect(res.body.message).toBe('Item not found');
    });

    it('returns 404 for unknown routes', async () => {
      const res = await http().get('/api/nope').expect(404);
      expectErrorShape(res.body, 404, 'NOT_FOUND');
    });

    it('hides internal error details behind a generic 500', async () => {
      const res = await http().get('/api/__probe/boom').expect(500);
      expectErrorShape(res.body, 500, 'INTERNAL_ERROR');
      expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
    });
  });

  describe('pagination (GEN-05)', () => {
    beforeAll(async () => {
      const model = app.get<Model<{ name: string; email: string }>>(
        getModelToken(ProbeModule.model),
      );
      await model.deleteMany({});
      await model.insertMany(
        Array.from({ length: 23 }, (_, i) => ({
          name: `item-${String(i).padStart(2, '0')}`,
          email: `p${i}@x.io`,
        })),
      );
    });

    it('returns 10 items per page with the envelope', async () => {
      const res = await http().get('/api/__probe/items').expect(200);
      expect(res.body).toMatchObject({
        page: 1,
        limit: 10,
        total: 23,
        totalPages: 3,
      });
      expect(res.body.items).toHaveLength(10);
      expect(res.body.items[0].name).toBe('item-00');
    });

    it('serves the last partial page and empty pages beyond it', async () => {
      const last = await http().get('/api/__probe/items?page=3').expect(200);
      expect(last.body.items.map((i: { name: string }) => i.name)).toEqual([
        'item-20',
        'item-21',
        'item-22',
      ]);
      const beyond = await http().get('/api/__probe/items?page=4').expect(200);
      expect(beyond.body).toMatchObject({ page: 4, items: [], total: 23 });
    });

    it('rejects a page size even on routes without a pagination DTO', async () => {
      const res = await http()
        .get('/api/__probe/cast/xyz?perPage=50')
        .expect(400);
      expectErrorShape(res.body, 400, 'VALIDATION_FAILED');
      expect(res.body.fieldErrors).toEqual([
        { field: 'perPage', message: 'property perPage should not exist' },
      ]);
    });

    it('does not echo the query string in the error path', async () => {
      const res = await http().get('/api/nope?token=secret').expect(404);
      expect(res.body.path).toBe('/api/nope');
    });

    it.each([
      'limit=50',
      'pageSize=5',
      'page=0',
      'page=-1',
      'page=abc',
      'page=1.5',
      'page=0x10',
      'page=1e1',
    ])('rejects ?%s with 400', async (qs) => {
      const res = await http().get(`/api/__probe/items?${qs}`).expect(400);
      expectErrorShape(res.body, 400, 'VALIDATION_FAILED');
    });
  });
});

/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { existsSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { BadRequestException, INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuditService } from '../src/common/contracts/audit.contract';
import type { CurrencyService } from '../src/common/contracts/currency.contract';
import {
  AUDIT_SERVICE,
  CURRENCY_SERVICE,
  UPLOADS_SERVICE,
} from '../src/common/contracts/tokens';
import type {
  UploadedImageFile,
  UploadsService,
} from '../src/common/contracts/uploads.contract';
import {
  asAdmin,
  asUser,
  createTestApp,
  FX_RATES,
  TestApp,
} from './utils/test-app';

jest.setTimeout(120_000);

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const MB5 = 5 * 1024 * 1024;

function file(
  magic: Buffer,
  mimetype: string,
  size = 1024,
  name = 'pic',
): UploadedImageFile {
  const buffer = Buffer.concat([
    magic,
    Buffer.alloc(Math.max(size - magic.length, 0), 1),
  ]);
  return { originalname: name, mimetype, size: buffer.length, buffer };
}

describe('Audit, uploads, currency (e2e)', () => {
  let t: TestApp;
  let app: INestApplication;
  let audit: AuditService;
  let uploads: UploadsService;
  let currency: CurrencyService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
    app = t.app;
    audit = app.get(AUDIT_SERVICE);
    uploads = app.get(UPLOADS_SERVICE);
    currency = app.get(CURRENCY_SERVICE);
  });
  afterAll(async () => {
    await t.close();
  });

  describe('GEN-07 audit log', () => {
    const actorA = 'a1'.repeat(12);
    const actorB = 'b2'.repeat(12);

    beforeAll(async () => {
      for (let i = 0; i < 12; i++) {
        await audit.record({
          actorId: i % 3 === 0 ? actorB : actorA,
          action: i % 2 === 0 ? 'USER_SUSPENDED' : 'PAYMENT_SUCCEEDED',
          targetType: 'USER',
          targetId: `t${i}`,
          metadata: { i },
        });
        await new Promise((r) => setTimeout(r, 5));
      }
      await audit.record({
        actorId: null,
        action: 'SYSTEM_JOB',
        targetType: 'JOB',
        targetId: 'hold-expiry',
      });
    });

    it('is admin only', async () => {
      await http().get('/api/admin/audit-logs').expect(401);
      await http().get('/api/admin/audit-logs').set(asUser()).expect(403);
      await http()
        .get('/api/admin/audit-logs')
        .set(asUser('d'.repeat(24), 'HOTEL_MOD'))
        .expect(403);
      await http().get('/api/admin/audit-logs').set(asAdmin()).expect(200);
    });

    it('is paginated newest-first', async () => {
      const p1 = await http()
        .get('/api/admin/audit-logs')
        .set(asAdmin())
        .expect(200);
      expect(p1.body.limit).toBe(10);
      expect(p1.body.total).toBe(13);
      expect(p1.body.totalPages).toBe(2);
      expect(p1.body.items).toHaveLength(10);
      expect(p1.body.items[0].action).toBe('SYSTEM_JOB');
      const dates = p1.body.items.map((e: any) =>
        new Date(e.createdAt).getTime(),
      );
      expect([...dates].sort((a, b) => b - a)).toEqual(dates);

      const p2 = await http()
        .get('/api/admin/audit-logs?page=2')
        .set(asAdmin())
        .expect(200);
      expect(p2.body.items).toHaveLength(3);
      expect(p2.body.page).toBe(2);
    });

    it('filters by actor and by action', async () => {
      const byActor = await http()
        .get(`/api/admin/audit-logs?actorId=${actorB}`)
        .set(asAdmin())
        .expect(200);
      expect(byActor.body.total).toBe(4);
      expect(byActor.body.items.every((e: any) => e.actorId === actorB)).toBe(
        true,
      );

      const byAction = await http()
        .get('/api/admin/audit-logs?action=PAYMENT_SUCCEEDED')
        .set(asAdmin())
        .expect(200);
      expect(byAction.body.total).toBe(6);
      expect(
        byAction.body.items.every((e: any) => e.action === 'PAYMENT_SUCCEEDED'),
      ).toBe(true);
    });

    it('filters by date range', async () => {
      const future = new Date(Date.now() + 86_400_000).toISOString();
      const past = new Date(Date.now() - 86_400_000).toISOString();
      const none = await http()
        .get(`/api/admin/audit-logs?from=${encodeURIComponent(future)}`)
        .set(asAdmin())
        .expect(200);
      expect(none.body.total).toBe(0);
      const all = await http()
        .get(
          `/api/admin/audit-logs?from=${encodeURIComponent(past)}&to=${encodeURIComponent(future)}`,
        )
        .set(asAdmin())
        .expect(200);
      expect(all.body.total).toBe(13);
      await http()
        .get('/api/admin/audit-logs?from=not-a-date')
        .set(asAdmin())
        .expect(400);
    });

    it('exposes no way to modify or delete entries', async () => {
      const list = await http().get('/api/admin/audit-logs').set(asAdmin());
      const id = list.body.items[0].id ?? list.body.items[0]._id;
      for (const method of ['put', 'patch', 'delete'] as const) {
        const res = await http()
          [method](`/api/admin/audit-logs/${id}`)
          .set(asAdmin());
        expect([404, 405]).toContain(res.status);
      }
      await http().delete('/api/admin/audit-logs').set(asAdmin()).expect(404);
    });
  });

  describe('GEN-08 uploads', () => {
    it('stores a PNG and serves it publicly with the same bytes', async () => {
      const [img] = await uploads.saveImages([file(PNG_MAGIC, 'image/png')], {
        max: 5,
      });
      expect(img.mimetype).toBe('image/png');
      expect(img.url).toMatch(/\.png$/);
      const name = basename(img.url);
      expect(readdirSync(t.uploadDir)).toContain(name);
      const res = await http()
        .get(`/api/uploads/${name}`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-type']).toContain('image/png');
      expect((res.body as Buffer).subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    });

    it('accepts a JPG and exactly 5 MB', async () => {
      const out = await uploads.saveImages(
        [file(JPG_MAGIC, 'image/jpeg', MB5)],
        { max: 1 },
      );
      expect(out[0].url).toMatch(/\.(jpg|jpeg)$/);
    });

    it('rejects > 5 MB, wrong MIME, spoofed magic bytes and too many files with 400', async () => {
      await expect(
        uploads.saveImages([file(PNG_MAGIC, 'image/png', MB5 + 1)], { max: 5 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        uploads.saveImages([file(PNG_MAGIC, 'image/gif')], { max: 5 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        uploads.saveImages([file(PNG_MAGIC, 'application/pdf')], { max: 5 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      // claims PNG but bytes are plain text / a script
      await expect(
        uploads.saveImages(
          [
            {
              originalname: 'evil.png',
              mimetype: 'image/png',
              size: 12,
              buffer: Buffer.from('<script>x</script>'),
            },
          ],
          { max: 5 },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      // JPG bytes labelled PNG
      await expect(
        uploads.saveImages([file(JPG_MAGIC, 'image/png')], { max: 5 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      // max per call
      await expect(
        uploads.saveImages(
          [file(PNG_MAGIC, 'image/png'), file(PNG_MAGIC, 'image/png')],
          { max: 1 },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      const six = Array.from({ length: 6 }, () => file(PNG_MAGIC, 'image/png'));
      await expect(uploads.saveImages(six, { max: 5 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('stores nothing from a rejected batch', async () => {
      const before = readdirSync(t.uploadDir).length;
      await expect(
        uploads.saveImages(
          [file(PNG_MAGIC, 'image/png'), file(PNG_MAGIC, 'image/gif')],
          { max: 5 },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(readdirSync(t.uploadDir).length).toBe(before);
    });

    it('404s for unknown files and refuses path traversal', async () => {
      await http().get('/api/uploads/does-not-exist.png').expect(404);
      const res = await http().get('/api/uploads/..%2f..%2fpackage.json');
      expect([400, 404]).toContain(res.status);
    });

    it('deleteImage removes the file', async () => {
      const [img] = await uploads.saveImages([file(PNG_MAGIC, 'image/png')], {
        max: 1,
      });
      await uploads.deleteImage(img.id);
      await http()
        .get(`/api/uploads/${basename(img.url)}`)
        .expect(404);
      expect(existsSync(`${t.uploadDir}/${basename(img.url)}`)).toBe(false);
    });
  });

  describe('ITN-18 currency', () => {
    it('lists supported currencies publicly', async () => {
      const res = await http().get('/api/currencies').expect(200);
      expect([...res.body.items].sort()).toEqual(
        ['AED', 'EGP', 'EUR', 'GBP', 'JPY', 'SAR', 'USD'].sort(),
      );
      await expect(currency.supportedCurrencies()).resolves.toEqual(
        expect.arrayContaining(['USD', 'EGP']),
      );
    });

    it('exposes base, rateDate and rates', async () => {
      const res = await http().get('/api/currencies/rates').expect(200);
      expect(res.body.base).toBe('USD');
      expect(res.body.rateDate).toEqual(expect.any(String));
      expect(res.body.rates.EGP).toBeCloseTo(FX_RATES.EGP, 4);
    });

    it('converts minor units using the fetched rate', async () => {
      const r = await currency.convert(10000, 'USD', 'EGP');
      expect(r.rate).toBeCloseTo(FX_RATES.EGP, 4);
      expect(r.amountMinor).toBe(Math.round(10000 * FX_RATES.EGP));
      expect(r.rateDate).toEqual(expect.any(String));
    });

    it('respects currency exponents (JPY has none) and identity conversion', async () => {
      // 100.00 USD (10000 minor) -> JPY (0 decimals): 150 JPY per USD
      const jpy = await currency.convert(10000, 'USD', 'JPY');
      expect(jpy.amountMinor).toBe(15000);
      const same = await currency.convert(12345, 'USD', 'USD');
      expect(same.amountMinor).toBe(12345);
    });

    it('converts across two non-base currencies via the USD base', async () => {
      const r = await currency.convert(10000, 'EUR', 'GBP');
      const expected = Math.round(10000 * (FX_RATES.GBP / FX_RATES.EUR));
      expect(Math.abs(r.amountMinor - expected)).toBeLessThanOrEqual(1);
    });

    it('rejects unsupported codes with 400', async () => {
      await expect(currency.convert(100, 'USD', 'XYZ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(currency.convert(100, 'ABC', 'USD')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('keeps serving the last cached rates when the FX API goes down', async () => {
      t.fx.setFailing(true);
      const r = await currency.convert(10000, 'USD', 'EGP');
      expect(r.amountMinor).toBe(Math.round(10000 * FX_RATES.EGP));
      await http().get('/api/currencies/rates').expect(200);
    });
  });
});

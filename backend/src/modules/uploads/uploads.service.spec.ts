import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { UPLOAD_LIMITS, type UploadedFileLike } from '../../common/contracts';
import { ValidationFailedException } from '../../common/errors/app.exception';
import type { EnvironmentVariables } from '../../config/env.validation';
import { detectImageKind, ImageUploadsService } from './uploads.service';

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const ENTITY = 'a'.repeat(24);

const file = (
  buffer: Buffer,
  originalname = 'photo.png',
  mimetype = 'image/png',
): UploadedFileLike => ({
  originalname,
  mimetype,
  size: buffer.length,
  buffer,
});
const png = (extraBytes = 16) =>
  file(Buffer.concat([PNG_HEADER, Buffer.alloc(extraBytes, 1)]));
const jpeg = (extraBytes = 16) =>
  file(
    Buffer.concat([JPEG_HEADER, Buffer.alloc(extraBytes, 1)]),
    'photo.jpg',
    'image/jpeg',
  );

async function fieldErrors(attempt: Promise<unknown>) {
  try {
    await attempt;
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationFailedException);
    return (e as ValidationFailedException).fieldErrors ?? [];
  }
  throw new Error('expected the upload to be rejected');
}

describe('ImageUploadsService (GEN-08)', () => {
  let dir: string;
  let service: ImageUploadsService;
  const stored = (folder: string) =>
    existsSync(join(dir, folder)) ? readdirSync(join(dir, folder)) : [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'uploads-spec-'));
    service = new ImageUploadsService({
      get: () => dir,
    } as unknown as ConfigService<EnvironmentVariables, true>);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('detectImageKind', () => {
    it('recognises PNG and JPEG by their first bytes', () => {
      expect(detectImageKind(png().buffer)).toBe('png');
      expect(detectImageKind(jpeg().buffer)).toBe('jpg');
    });

    it.each([
      ['a GIF', Buffer.from('GIF89a........')],
      ['an SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
      ['HTML', Buffer.from('<html><script>alert(1)</script></html>')],
      ['a PDF', Buffer.from('%PDF-1.7 ......')],
      ['a truncated PNG header', PNG_HEADER.subarray(0, 4)],
      ['nothing', Buffer.alloc(0)],
    ])('refuses %s', (_name, buffer) => {
      expect(detectImageKind(buffer)).toBeNull();
    });
  });

  describe('saveImages', () => {
    it('stores a JPG and a PNG and returns a URL for each', async () => {
      const images = await service.saveImages([jpeg(), png()], {
        entityType: 'POST',
        entityId: ENTITY,
        existingCount: 0,
      });
      expect(images).toHaveLength(2);
      expect(images[0].url).toMatch(
        new RegExp(`^/uploads/posts/${ENTITY}-[a-f0-9-]{36}\\.jpg$`),
      );
      expect(images[1].url).toMatch(
        new RegExp(`^/uploads/posts/${ENTITY}-[a-f0-9-]{36}\\.png$`),
      );
      expect(images[0].url).toContain(images[0].imageId);
      expect(stored('posts')).toHaveLength(2);
      const saved = readFileSync(
        join(dir, 'posts', images[1].url.split('/').pop() as string),
      );
      expect(saved.equals(png().buffer)).toBe(true);
    });

    it.each([
      ['POST', 'posts'],
      ['ACTIVITY', 'activities'],
      ['HOTEL', 'hotels'],
      ['AIRLINE_LOGO', 'airlines'],
    ] as const)('puts %s images in /uploads/%s', async (entityType, folder) => {
      const [image] = await service.saveImages([png()], {
        entityType,
        entityId: ENTITY,
        existingCount: 0,
      });
      expect(image.url.startsWith(`/uploads/${folder}/`)).toBe(true);
    });

    it('decides the extension from the content, never from the file name or declared type', async () => {
      const disguised = file(png().buffer, '../../evil.php', 'text/html');
      const [image] = await service.saveImages([disguised], {
        entityType: 'HOTEL',
        entityId: ENTITY,
        existingCount: 0,
      });
      expect(image.url).toMatch(/\.png$/);
      expect(image.url).not.toContain('evil');
      expect(stored('hotels')).toHaveLength(1);
      expect(readdirSync(dir)).toEqual(['hotels']);
    });

    it('rejects a file that is not a JPG or PNG even when it is named like one', async () => {
      const fake = file(
        Buffer.from('<html><script>alert(1)</script></html>'),
        'photo.png',
        'image/png',
      );
      await expect(
        fieldErrors(
          service.saveImages([fake], {
            entityType: 'POST',
            entityId: ENTITY,
            existingCount: 0,
          }),
        ),
      ).resolves.toEqual([
        { field: 'files[0]', message: 'Only JPG and PNG images are accepted' },
      ]);
    });

    it('accepts exactly 5 MB and rejects one byte more', async () => {
      const target = {
        entityType: 'POST' as const,
        entityId: ENTITY,
        existingCount: 0,
      };
      const atLimit = png(UPLOAD_LIMITS.maxBytes - PNG_HEADER.length);
      expect(atLimit.buffer.length).toBe(5 * 1024 * 1024);
      await expect(service.saveImages([atLimit], target)).resolves.toHaveLength(
        1,
      );
      const over = png(UPLOAD_LIMITS.maxBytes - PNG_HEADER.length + 1);
      await expect(
        fieldErrors(service.saveImages([over], target)),
      ).resolves.toEqual([
        {
          field: 'files[0]',
          message: 'The image is 5 MB; the maximum is 5 MB',
        },
      ]);
    });

    it('rejects an empty file and an empty batch', async () => {
      const target = {
        entityType: 'POST' as const,
        entityId: ENTITY,
        existingCount: 0,
      };
      await expect(
        fieldErrors(service.saveImages([file(Buffer.alloc(0))], target)),
      ).resolves.toEqual([{ field: 'files[0]', message: 'The file is empty' }]);
      await expect(
        fieldErrors(service.saveImages([], target)),
      ).resolves.toEqual([
        { field: 'files', message: 'Attach at least one JPG or PNG image' },
      ]);
    });

    it('allows up to 5 images per post, activity or hotel, counting the ones already attached', async () => {
      await expect(
        service.saveImages([png(), png()], {
          entityType: 'ACTIVITY',
          entityId: ENTITY,
          existingCount: 3,
        }),
      ).resolves.toHaveLength(2);
      await expect(
        fieldErrors(
          service.saveImages([png(), png(), png()], {
            entityType: 'ACTIVITY',
            entityId: ENTITY,
            existingCount: 3,
          }),
        ),
      ).resolves.toEqual([
        {
          field: 'files',
          message:
            'At most 5 images are allowed here: 3 already attached, 3 more sent',
        },
      ]);
      await expect(
        fieldErrors(
          service.saveImages([png()], {
            entityType: 'HOTEL',
            entityId: ENTITY,
            existingCount: 5,
          }),
        ),
      ).resolves.toHaveLength(1);
    });

    it('allows one logo per airline', async () => {
      await expect(
        fieldErrors(
          service.saveImages([png(), png()], {
            entityType: 'AIRLINE_LOGO',
            entityId: ENTITY,
            existingCount: 0,
          }),
        ),
      ).resolves.toEqual([
        {
          field: 'files',
          message: 'An airline has 1 logo; upload a single image',
        },
      ]);
      await expect(
        fieldErrors(
          service.saveImages([png()], {
            entityType: 'AIRLINE_LOGO',
            entityId: ENTITY,
            existingCount: 1,
          }),
        ),
      ).resolves.toHaveLength(1);
    });

    it('rejects the whole batch and writes nothing when one file is invalid', async () => {
      const errors = await fieldErrors(
        service.saveImages([png(), file(Buffer.from('not an image')), jpeg()], {
          entityType: 'POST',
          entityId: ENTITY,
          existingCount: 0,
        }),
      );
      expect(errors).toEqual([
        { field: 'files[1]', message: 'Only JPG and PNG images are accepted' },
      ]);
      expect(stored('posts')).toHaveLength(0);
    });

    it('refuses an entity id that is not a 24-hex id, so nothing odd reaches a file name', async () => {
      await expect(
        service.saveImages([png()], {
          entityType: 'POST',
          entityId: '../../etc',
          existingCount: 0,
        }),
      ).rejects.toThrow('24-hex id');
      expect(readdirSync(dir)).toEqual([]);
    });
  });

  describe('deleteImage', () => {
    it('removes a stored file, and removing it again is harmless', async () => {
      const [image] = await service.saveImages([png()], {
        entityType: 'AIRLINE_LOGO',
        entityId: ENTITY,
        existingCount: 0,
      });
      expect(stored('airlines')).toHaveLength(1);
      await service.deleteImage(image.url);
      expect(stored('airlines')).toHaveLength(0);
      await expect(service.deleteImage(image.url)).resolves.toBeUndefined();
    });

    it.each([
      'https://cdn.example.com/logo.png',
      '/uploads/airlines/../../../etc/passwd',
      '/uploads/secrets/aaaaaaaaaaaaaaaaaaaaaaaa-00000000-0000-0000-0000-000000000000.png',
      '/uploads/airlines/logo.png',
      '',
    ])('ignores a URL it did not produce: %s', async (url) => {
      const [image] = await service.saveImages([png()], {
        entityType: 'AIRLINE_LOGO',
        entityId: ENTITY,
        existingCount: 0,
      });
      await expect(service.deleteImage(url)).resolves.toBeUndefined();
      expect(stored('airlines')).toEqual([image.url.split('/').pop()]);
    });
  });
});

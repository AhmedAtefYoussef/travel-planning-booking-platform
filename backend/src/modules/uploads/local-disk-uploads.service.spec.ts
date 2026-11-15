import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/errors/app.exception';
import {
  UPLOAD_LIMITS,
  UploadedFileLike,
} from '../../common/contracts/services.contract';
import { LocalDiskUploadsService } from './local-disk-uploads.service';

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0];

/** A buffer of exactly `size` bytes that starts with the given signature. */
function image(header: number[], size = 64): Buffer {
  const buf = Buffer.alloc(size);
  Buffer.from(header).copy(buf);
  return buf;
}

function file(
  buffer: Buffer,
  mimetype = 'image/png',
  originalname = 'photo.png',
): UploadedFileLike {
  return { buffer, mimetype, originalname, size: buffer.length };
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function rejection(promise: Promise<unknown>): Promise<AppException> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppException);
    return err as AppException;
  }
  throw new Error('expected a rejection');
}

function fieldsOf(err: AppException): string[] {
  return (err.fieldErrors ?? []).map((e) => e.field);
}

describe('LocalDiskUploadsService (GEN-08)', () => {
  let root: string;
  let service: LocalDiskUploadsService;
  const hotel = { entityType: 'HOTEL' as const, entityId: 'h1' };

  /** Every file under UPLOAD_DIR, as "<folder>/<name>". */
  const stored = (): string[] =>
    existsSync(root)
      ? readdirSync(root, { recursive: true, withFileTypes: true })
          .filter((d) => d.isFile())
          .map((d) => `${d.parentPath.slice(root.length + 1)}/${d.name}`)
      : [];

  beforeEach(() => {
    root = join(mkdtempSync(join(tmpdir(), 'gen08-unit-')), 'uploads');
    service = new LocalDiskUploadsService({
      getOrThrow: () => root,
    } as unknown as ConfigService);
  });

  afterEach(() => {
    rmSync(join(root, '..'), { recursive: true, force: true });
  });

  it('stores each image under <folder>/<uuid>.<ext>, never using originalname', async () => {
    const result = await service.saveImages(
      [
        file(image(PNG_HEADER), 'image/png', '../../evil.png'),
        file(image(JPEG_HEADER), 'image/jpeg', 'x/../../y.jpg'),
      ],
      { ...hotel, existingCount: 0 },
    );
    expect(result).toHaveLength(2);
    expect(result[0].imageId).toMatch(UUID);
    expect(result[0].url).toBe(`/uploads/hotels/${result[0].imageId}.png`);
    expect(result[1].url).toBe(`/uploads/hotels/${result[1].imageId}.jpg`);
    expect(stored().sort()).toEqual(
      [
        `hotels/${result[0].imageId}.png`,
        `hotels/${result[1].imageId}.jpg`,
      ].sort(),
    );
  });

  it.each([
    ['POST', 'posts'],
    ['ACTIVITY', 'activities'],
    ['AIRLINE_LOGO', 'airlines'],
  ] as const)('%s images go to /uploads/%s/', async (entityType, folder) => {
    const [img] = await service.saveImages([file(image(PNG_HEADER))], {
      entityType,
      entityId: 'e1',
      existingCount: 0,
    });
    expect(img.url).toBe(`/uploads/${folder}/${img.imageId}.png`);
  });

  it('exactly 5 MB is accepted, 5 MB + 1 byte rejected', async () => {
    const max = UPLOAD_LIMITS.maxBytes;
    expect(max).toBe(5 * 1024 * 1024);
    await expect(
      service.saveImages([file(image(PNG_HEADER, max))], {
        ...hotel,
        existingCount: 0,
      }),
    ).resolves.toHaveLength(1);

    const err = await rejection(
      service.saveImages([file(image(PNG_HEADER, max + 1))], {
        ...hotel,
        existingCount: 0,
      }),
    );
    expect(err.getStatus()).toBe(400);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(fieldsOf(err)).toEqual(['images']);
    expect(stored()).toHaveLength(1);
  });

  it('sixth image rejected and nothing written', async () => {
    const err = await rejection(
      service.saveImages([file(image(PNG_HEADER))], {
        ...hotel,
        existingCount: 5,
      }),
    );
    expect(err.getStatus()).toBe(400);
    expect(fieldsOf(err)).toEqual(['images']);

    // 3 already + 3 new: the whole batch is refused, even the files that would fit.
    await rejection(
      service.saveImages(
        [1, 2, 3].map(() => file(image(PNG_HEADER))),
        { ...hotel, existingCount: 3 },
      ),
    );
    expect(stored()).toEqual([]);
  });

  it('an airline has at most one logo, reported on the logo field', async () => {
    const err = await rejection(
      service.saveImages([file(image(PNG_HEADER)), file(image(PNG_HEADER))], {
        entityType: 'AIRLINE_LOGO',
        entityId: 'a1',
        existingCount: 0,
      }),
    );
    expect(fieldsOf(err)).toEqual(['logo']);
    await rejection(
      service.saveImages([file(image(PNG_HEADER))], {
        entityType: 'AIRLINE_LOGO',
        entityId: 'a1',
        existingCount: 1,
      }),
    );
    expect(stored()).toEqual([]);
  });

  it('rejects an empty batch', async () => {
    const err = await rejection(
      service.saveImages([], { ...hotel, existingCount: 0 }),
    );
    expect(fieldsOf(err)).toEqual(['images']);
  });

  it('takes the type from the bytes: text sent as image/png, a declared/actual mismatch and other types are 400', async () => {
    for (const bad of [
      file(Buffer.from('just some text pretending'), 'image/png', 'a.png'),
      file(image(JPEG_HEADER), 'image/png'),
      file(image(PNG_HEADER), 'image/gif'),
    ]) {
      const err = await rejection(
        service.saveImages([file(image(PNG_HEADER)), bad], {
          ...hotel,
          existingCount: 0,
        }),
      );
      expect(fieldsOf(err)).toEqual(['images']);
    }
    expect(stored()).toEqual([]);
  });

  it('does not trust the declared size: the buffer length is checked', async () => {
    const big = image(PNG_HEADER, UPLOAD_LIMITS.maxBytes + 1);
    await rejection(
      service.saveImages([{ ...file(big), size: 10 }], {
        ...hotel,
        existingCount: 0,
      }),
    );
    expect(stored()).toEqual([]);
  });

  it('deletes the files already written when a later write fails', async () => {
    const target = service as unknown as {
      writeNew(path: string, buf: Buffer): Promise<void>;
    };
    const original = target.writeNew.bind(service);
    jest
      .spyOn(target, 'writeNew')
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('disk full'));
    await expect(
      service.saveImages([file(image(PNG_HEADER)), file(image(PNG_HEADER))], {
        ...hotel,
        existingCount: 0,
      }),
    ).rejects.toThrow('disk full');
    expect(stored()).toEqual([]);
  });

  it('removes a partial file when a write fails after creating it', async () => {
    const target = service as unknown as {
      writeNew(path: string, buf: Buffer): Promise<void>;
    };
    jest
      .spyOn(target, 'writeNew')
      .mockImplementationOnce((path: string, buf: Buffer) => {
        // The file exists (half written) when the write fails.
        writeFileSync(path, buf.subarray(0, 4));
        return Promise.reject(new Error('EIO mid-write'));
      });
    await expect(
      service.saveImages([file(image(PNG_HEADER))], {
        ...hotel,
        existingCount: 0,
      }),
    ).rejects.toThrow('EIO mid-write');
    expect(stored()).toEqual([]);
  });

  it('never deletes an existing file that a write refused with EEXIST', async () => {
    const target = service as unknown as {
      writeNew(path: string, buf: Buffer): Promise<void>;
    };
    let taken = '';
    jest.spyOn(target, 'writeNew').mockImplementationOnce((path: string) => {
      taken = path;
      writeFileSync(path, 'someone else');
      return Promise.reject(
        Object.assign(new Error('exists'), { code: 'EEXIST' }),
      );
    });
    await expect(
      service.saveImages([file(image(PNG_HEADER))], {
        ...hotel,
        existingCount: 0,
      }),
    ).rejects.toThrow('exists');
    expect(existsSync(taken)).toBe(true);
  });

  it('deleteImage removes a stored image and ignores one that is already gone', async () => {
    const [img] = await service.saveImages([file(image(PNG_HEADER))], {
      ...hotel,
      existingCount: 0,
    });
    await service.deleteImage(img.url);
    expect(stored()).toEqual([]);
    await expect(service.deleteImage(img.url)).resolves.toBeUndefined();
  });

  it('deleteImage refuses paths outside UPLOAD_DIR', async () => {
    const outside = join(root, '..', 'secret.png');
    writeFileSync(outside, 'keep me');
    const [img] = await service.saveImages([file(image(PNG_HEADER))], {
      ...hotel,
      existingCount: 0,
    });
    for (const url of [
      '/uploads/hotels/../secret.png',
      '/uploads/../secret.png',
      '/uploads/hotels/..%2Fsecret.png',
      '/uploads/hotels/x/../../../secret.png',
      `/uploads/hotels/${img.imageId}.png/../../../secret.png`,
      'https://cdn.example.com/uploads/hotels/a.png',
      `/uploads/elsewhere/${img.imageId}.png`,
      `/uploads/hotels/${img.imageId}.gif`,
      `/uploads/hotels/${img.imageId}.png?x=1`,
      outside,
    ]) {
      await expect(service.deleteImage(url)).resolves.toBeUndefined();
    }
    expect(existsSync(outside)).toBe(true);
    expect(stored()).toEqual([`hotels/${img.imageId}.png`]);
  });

  it('rejects an unknown entity type', async () => {
    await expect(
      service.saveImages([file(image(PNG_HEADER))], {
        entityType: 'USER' as never,
        entityId: 'u1',
        existingCount: 0,
      }),
    ).rejects.toThrow();
  });
});

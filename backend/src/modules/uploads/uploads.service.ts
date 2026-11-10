import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  UPLOAD_LIMITS,
  type StoredImage,
  type UploadEntityType,
  type UploadedFileLike,
  type UploadsService,
} from '../../common/contracts';
import {
  ValidationFailedException,
  type FieldError,
} from '../../common/errors/app.exception';
import type { EnvironmentVariables } from '../../config/env.validation';

/** URL prefix the stored files are served under (app.setup.ts). */
export const UPLOADS_URL_PREFIX = '/uploads';

/** One folder per kind of entity, so a URL shows what an image belongs to. */
const FOLDERS: Record<UploadEntityType, string> = {
  POST: 'posts',
  ACTIVITY: 'activities',
  HOTEL: 'hotels',
  AIRLINE_LOGO: 'airlines',
};

type ImageKind = 'jpg' | 'png';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

/** The real format of the bytes, whatever the file name or the browser's content type claim. */
export function detectImageKind(buffer: Buffer): ImageKind | null {
  const startsWith = (signature: number[]) =>
    buffer.length >= signature.length &&
    signature.every((byte, i) => buffer[i] === byte);
  if (startsWith(PNG_SIGNATURE)) return 'png';
  if (startsWith(JPEG_SIGNATURE)) return 'jpg';
  return null;
}

/** Only URLs this service produced: /uploads/<folder>/<24-hex entity id>-<uuid>.<jpg|png> */
const STORED_URL = new RegExp(
  `^${UPLOADS_URL_PREFIX}/(${Object.values(FOLDERS).join('|')})/([a-f0-9]{24}-[a-f0-9-]{36}\\.(?:jpg|png))$`,
);

const megabytes = (bytes: number) =>
  `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

/**
 * GEN-08 image storage, exposed to other modules as UPLOADS_SERVICE. One place enforces the shared
 * media rule for posts (BLG-10), activities (ITN-12), hotels (HTL-01) and airline logos (FLT-01):
 * JPG or PNG only, at most 5 MB each, at most 5 images per entity and 1 logo per airline.
 *
 * - The format is decided from the file's first bytes, so a renamed script or HTML page is refused.
 * - A batch is validated completely before anything is written: one bad file rejects all of them.
 * - File names are generated here (entity id + random UUID); nothing from the client reaches the
 *   file system path, so path traversal is not possible.
 * - Files live under UPLOAD_DIR and are served read-only at /uploads (app.setup.ts).
 */
@Injectable()
export class ImageUploadsService implements UploadsService {
  private readonly logger = new Logger(ImageUploadsService.name);

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** Absolute directory the files are stored in. */
  get rootDir(): string {
    return resolve(this.config.get('UPLOAD_DIR', { infer: true }));
  }

  async saveImages(
    files: UploadedFileLike[],
    target: {
      entityType: UploadEntityType;
      entityId: string;
      existingCount: number;
    },
  ): Promise<StoredImage[]> {
    const folder = FOLDERS[target.entityType];
    if (!folder || !/^[a-f0-9]{24}$/.test(target.entityId)) {
      // A programming error in the calling module, not something a client can cause.
      throw new Error('saveImages needs a known entity type and a 24-hex id');
    }
    const kinds = this.validate(files, target.entityType, target.existingCount);

    const directory = join(this.rootDir, folder);
    await mkdir(directory, { recursive: true });
    const stored: { image: StoredImage; path: string }[] = [];
    try {
      for (const [i, file] of files.entries()) {
        const imageId = `${target.entityId}-${randomUUID()}`;
        const fileName = `${imageId}.${kinds[i]}`;
        const path = join(directory, fileName);
        // 'wx': never overwrite an existing file, even if a UUID were ever to repeat.
        await writeFile(path, file.buffer, { flag: 'wx' });
        stored.push({
          path,
          image: {
            imageId,
            url: `${UPLOADS_URL_PREFIX}/${folder}/${fileName}`,
          },
        });
      }
    } catch (e) {
      // All or nothing: a failed write must not leave part of the batch on disk.
      await Promise.all(
        stored.map((s) => unlink(s.path).catch(() => undefined)),
      );
      throw e;
    }
    return stored.map((s) => s.image);
  }

  /**
   * Removes a file this service stored. Any other value (an external link kept from before uploads
   * existed, or a malformed URL) is ignored, and so is a file that is already gone.
   */
  async deleteImage(url: string): Promise<void> {
    const match = STORED_URL.exec(url);
    if (!match) return;
    const [, folder, fileName] = match;
    try {
      await unlink(join(this.rootDir, folder, fileName));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.logger.warn(
        `Could not delete ${url}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Returns the detected format of every file, or throws 400 listing every problem (GEN-02). */
  private validate(
    files: UploadedFileLike[],
    entityType: UploadEntityType,
    existingCount: number,
  ): ImageKind[] {
    if (!Array.isArray(files) || files.length === 0) {
      throw new ValidationFailedException([
        { field: 'files', message: 'Attach at least one JPG or PNG image' },
      ]);
    }
    const errors: FieldError[] = [];
    const isLogo = entityType === 'AIRLINE_LOGO';
    const limit = isLogo
      ? UPLOAD_LIMITS.maxAirlineLogos
      : UPLOAD_LIMITS.maxImagesPerEntity;
    if (existingCount + files.length > limit) {
      errors.push({
        field: 'files',
        message: isLogo
          ? `An airline has ${limit} logo; upload a single image`
          : `At most ${limit} images are allowed here: ${existingCount} already attached, ${files.length} more sent`,
      });
    }
    const kinds: ImageKind[] = [];
    for (const [i, file] of files.entries()) {
      const field = `files[${i}]`;
      const buffer = Buffer.isBuffer(file?.buffer) ? file.buffer : null;
      if (!buffer || buffer.length === 0) {
        errors.push({ field, message: 'The file is empty' });
        continue;
      }
      if (buffer.length > UPLOAD_LIMITS.maxBytes) {
        errors.push({
          field,
          message: `The image is ${megabytes(buffer.length)}; the maximum is ${megabytes(UPLOAD_LIMITS.maxBytes)}`,
        });
        continue;
      }
      const kind = detectImageKind(buffer);
      if (!kind) {
        errors.push({
          field,
          message: 'Only JPG and PNG images are accepted',
        });
        continue;
      }
      kinds.push(kind);
    }
    if (errors.length) throw new ValidationFailedException(errors);
    return kinds;
  }
}

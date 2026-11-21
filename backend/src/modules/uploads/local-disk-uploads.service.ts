import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  UPLOAD_LIMITS,
  type StoredImage,
  type UploadEntityType,
  type UploadedFileLike,
  type UploadsService,
} from '../../common/contracts/services.contract';
import { ValidationFailedException } from '../../common/errors/app.exception';
import type { FieldError } from '../../common/errors/app.exception';
import {
  localUploadUrlPattern,
  type UploadFolder,
} from '../../common/validation';
import { sniffImageType } from './image-signature';

/** Where each kind of entity keeps its images, and how many it may have in total. */
const TARGETS: Record<
  UploadEntityType,
  { folder: UploadFolder; max: number; field: string }
> = {
  POST: {
    folder: 'posts',
    max: UPLOAD_LIMITS.maxImagesPerEntity,
    field: 'images',
  },
  ACTIVITY: {
    folder: 'activities',
    max: UPLOAD_LIMITS.maxImagesPerEntity,
    field: 'images',
  },
  HOTEL: {
    folder: 'hotels',
    max: UPLOAD_LIMITS.maxImagesPerEntity,
    field: 'images',
  },
  AIRLINE_LOGO: {
    folder: 'airlines',
    max: UPLOAD_LIMITS.maxAirlineLogos,
    field: 'logo',
  },
};

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png' } as const;
const STORED_URL = localUploadUrlPattern([
  'posts',
  'activities',
  'hotels',
  'airlines',
]);
const MAX_MB = UPLOAD_LIMITS.maxBytes / (1024 * 1024);

/**
 * GEN-08 image storage on the server's disk, served by URL from /uploads/ (app.setup.ts).
 *
 * Every rule is checked on the whole batch before anything is written, and the batch is all or nothing:
 * the type comes from the bytes (not the name or Content-Type), the size from the buffer, and file names
 * are fresh UUIDs (the client's `originalname` is never used), so a path can never leave UPLOAD_DIR.
 */
@Injectable()
export class LocalDiskUploadsService implements UploadsService {
  private readonly logger = new Logger(LocalDiskUploadsService.name);
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = resolve(config.getOrThrow<string>('UPLOAD_DIR'));
  }

  async saveImages(
    files: UploadedFileLike[],
    target: {
      entityType: UploadEntityType;
      entityId: string;
      existingCount: number;
    },
  ): Promise<StoredImage[]> {
    const spec = TARGETS[target.entityType];
    if (!spec) throw new Error(`Unknown upload entity ${target.entityType}`);
    const planned = this.check(files, target.existingCount, spec);

    const dir = this.inside(spec.folder);
    await mkdir(dir, { recursive: true });
    // Every path this call may have created, recorded BEFORE its write: a write that fails midway can
    // leave a partial (publicly servable) file, which must be removed too. remove() ignores ENOENT.
    const written: string[] = [];
    try {
      const stored: StoredImage[] = [];
      // One at a time, so that when a write fails every earlier one is known and can be removed.
      for (const { buffer, ext } of planned) {
        const imageId = randomUUID();
        const path = this.inside(spec.folder, `${imageId}.${ext}`);
        written.push(path);
        try {
          await this.writeNew(path, buffer);
        } catch (err) {
          // EEXIST: `wx` refused because the file belongs to someone else; never delete it.
          if ((err as NodeJS.ErrnoException).code === 'EEXIST') written.pop();
          throw err;
        }
        stored.push({
          imageId,
          url: `/uploads/${spec.folder}/${imageId}.${ext}`,
        });
      }
      return stored;
    } catch (err) {
      await Promise.all(written.map((path) => this.remove(path)));
      throw err;
    }
  }

  /**
   * Deletes a stored image. Only URLs this service could have produced are acted on; anything else
   * (an external link, a traversal attempt) is ignored. A file that is already gone is not an error.
   */
  async deleteImage(url: string): Promise<void> {
    const match = STORED_URL.exec(url);
    if (!match) return;
    const [, folder, id, ext] = match;
    await this.remove(this.inside(folder, `${id}.${ext}`));
  }

  /** Validates the batch; returns each file's bytes and extension, or throws 400 with every problem. */
  private check(
    files: UploadedFileLike[],
    existingCount: number,
    spec: { max: number; field: string },
  ): { buffer: Buffer; ext: 'jpg' | 'png' }[] {
    const errors: FieldError[] = [];
    const error = (message: string) =>
      errors.push({ field: spec.field, message });

    if (files.length === 0) error('Attach at least one JPG or PNG image');
    if (existingCount + files.length > spec.max) {
      error(
        spec.max === 1
          ? 'Send exactly one image: an airline has one logo'
          : `At most ${spec.max} images are allowed; ${existingCount} already stored, ${files.length} sent`,
      );
    }
    const planned = files.map((file, i) => {
      const label = files.length > 1 ? `File ${i + 1}` : 'The file';
      const buffer = file.buffer;
      if (!Buffer.isBuffer(buffer) || buffer.length > UPLOAD_LIMITS.maxBytes) {
        error(`${label} is larger than ${MAX_MB} MB`);
      }
      const sniffed = Buffer.isBuffer(buffer) ? sniffImageType(buffer) : null;
      if (!sniffed) {
        error(`${label} is not a JPG or PNG image`);
      } else if (file.mimetype !== sniffed) {
        error(
          `${label} was sent as ${String(file.mimetype)} but its content is ${sniffed}`,
        );
      }
      return { buffer, ext: sniffed ? EXTENSIONS[sniffed] : 'png' } as const;
    });
    if (errors.length) throw new ValidationFailedException(errors);
    return planned;
  }

  /** Resolves a path under UPLOAD_DIR and refuses anything that would land outside it. */
  private inside(...parts: string[]): string {
    const path = resolve(this.root, ...parts);
    if (!path.startsWith(this.root + sep)) {
      throw new Error('Upload path escapes UPLOAD_DIR');
    }
    return path;
  }

  /** Creates the file; `wx` fails instead of overwriting should a name ever repeat. */
  private async writeNew(path: string, buffer: Buffer): Promise<void> {
    await writeFile(path, buffer, { flag: 'wx' });
  }

  private async remove(path: string): Promise<void> {
    try {
      await rm(path, { force: true });
    } catch (err) {
      // Leaves an orphan file at worst; the caller's own outcome must not change because of it.
      this.logger.warn(`Could not delete ${path}: ${(err as Error).message}`);
    }
  }
}

import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  mixin,
  NestInterceptor,
  Type,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import { Observable } from 'rxjs';
import { UPLOAD_LIMITS } from '../../common/contracts/services.contract';
import {
  AppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

const MAX_MB = UPLOAD_LIMITS.maxBytes / (1024 * 1024);

/** Client-facing text for the multer limit errors (`field` is the expected form field). */
function limitMessage(err: MulterError, field: string, maxCount: number) {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return `Each image must be at most ${MAX_MB} MB`;
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE' && err.field !== field) {
    return `Send the image(s) in the "${field}" field`;
  }
  return `Send at most ${maxCount} image(s) in one request`;
}

const LIMIT_CODES = new Set([
  'LIMIT_FILE_SIZE',
  'LIMIT_FILE_COUNT',
  'LIMIT_UNEXPECTED_FILE',
]);

/**
 * GEN-08: parses a multipart/form-data upload of up to `maxCount` files in the `field` field into
 * memory (no temporary files), with multer's limits capping what is read: 5 MB per file, `maxCount`
 * files, a few small text fields. The handler receives the files through @UploadedFiles(); the
 * UPLOADS_SERVICE then checks the content and stores them. Multer limit errors become 400 with
 * fieldErrors on `field` (GEN-02); a malformed body is 400 BAD_REQUEST.
 *
 *   @UseInterceptors(ImageFilesInterceptor('images', UPLOAD_LIMITS.maxImagesPerEntity))
 */
export function ImageFilesInterceptor(
  field: string,
  maxCount: number,
): Type<NestInterceptor> {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: UPLOAD_LIMITS.maxBytes,
      files: maxCount,
      fields: 10,
      fieldSize: 1024,
      parts: maxCount + 10,
    },
  }).array(field, maxCount);

  class ImageFilesMixin implements NestInterceptor {
    async intercept(
      context: ExecutionContext,
      next: CallHandler,
    ): Promise<Observable<unknown>> {
      const http = context.switchToHttp();
      await new Promise<void>((resolve, reject) =>
        upload(
          http.getRequest<Request>(),
          http.getResponse<Response>(),
          (err: unknown) => (err ? reject(toHttpError(err)) : resolve()),
        ),
      );
      return next.handle();
    }
  }

  function toHttpError(err: unknown): Error {
    if (err instanceof MulterError && LIMIT_CODES.has(err.code)) {
      return new ValidationFailedException([
        { field, message: limitMessage(err, field, maxCount) },
      ]);
    }
    if (err instanceof HttpException) return err;
    // Other multer limits (too many fields or parts) and busboy parse failures (no boundary, truncated
    // body, bad part header): the request itself is malformed.
    return new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.BAD_REQUEST,
      'Malformed or oversized multipart/form-data body',
    );
  }

  return mixin(ImageFilesMixin);
}

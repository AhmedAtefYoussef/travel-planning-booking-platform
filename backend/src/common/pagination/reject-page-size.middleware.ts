import { HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

export const FORBIDDEN_PAGE_SIZE_PARAMS = [
  'limit',
  'pageSize',
  'page_size',
  'perPage',
  'per_page',
] as const;

/**
 * GEN-05 safety net on every route: the page size is fixed at 10, so a client-supplied page size is a
 * 400 even on endpoints whose query DTO would not have caught it (e.g. @Query('city') parameters).
 */
@Injectable()
export class RejectPageSizeMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const keys = Object.keys(req.query ?? {});
    const offending = keys.filter((k) =>
      (FORBIDDEN_PAGE_SIZE_PARAMS as readonly string[]).some(
        (p) => p.toLowerCase() === k.toLowerCase(),
      ),
    );
    if (offending.length) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Page size is fixed at 10; use the page parameter only (GEN-05)',
        offending.map((field) => ({
          field,
          message: `property ${field} should not exist`,
        })),
      );
    }
    next();
  }
}

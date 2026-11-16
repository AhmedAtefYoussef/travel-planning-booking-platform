import { HttpStatus, Injectable, PipeTransform } from '@nestjs/common';
import { ModeratableContentType } from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

const TYPES: ReadonlySet<string> = new Set(
  Object.values(ModeratableContentType),
);

/** `:type` in /api/admin/content/:type/:id (GEN-10): post, comment, review or itinerary, any case. */
@Injectable()
export class ParseContentTypePipe implements PipeTransform<
  unknown,
  ModeratableContentType
> {
  transform(value: unknown): ModeratableContentType {
    // An exact match against the enum values, so keys like "constructor" can never slip through.
    const type = typeof value === 'string' ? value.toUpperCase() : '';
    if (!TYPES.has(type)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Validation failed',
        [
          {
            field: 'type',
            message: 'type must be one of post, comment, review, itinerary',
          },
        ],
      );
    }
    return type as ModeratableContentType;
  }
}

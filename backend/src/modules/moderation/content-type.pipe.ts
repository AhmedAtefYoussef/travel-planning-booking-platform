import { Injectable, PipeTransform } from '@nestjs/common';
import { ModeratableContentType } from '../../common/contracts';
import { ValidationFailedException } from '../../common/errors/app.exception';

/** The `:type` segment of /api/admin/content/:type/:id (GEN-10), lower case like /admin/providers/:type. */
export const CONTENT_TYPE_SEGMENTS = Object.values(ModeratableContentType).map(
  (t) => t.toLowerCase(),
);

/** 400 with a `type` field error (GEN-02) unless the segment is post, comment, review or itinerary. */
@Injectable()
export class ParseContentTypePipe implements PipeTransform<
  unknown,
  ModeratableContentType
> {
  transform(value: unknown): ModeratableContentType {
    if (typeof value === 'string' && CONTENT_TYPE_SEGMENTS.includes(value)) {
      return value.toUpperCase() as ModeratableContentType;
    }
    throw new ValidationFailedException([
      {
        field: 'type',
        message: `type must be one of ${CONTENT_TYPE_SEGMENTS.join(', ')}`,
      },
    ]);
  }
}

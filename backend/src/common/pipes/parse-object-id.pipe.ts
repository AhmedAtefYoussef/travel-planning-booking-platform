import {
  ArgumentMetadata,
  HttpStatus,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * Validates a route/query id before it reaches a service, so a malformed id is a 400 instead of a
 * CastError deep in a query:  @Param('id', ParseObjectIdPipe) id: string
 */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<unknown, string> {
  transform(value: unknown, metadata: ArgumentMetadata): string {
    const field = metadata.data ?? 'id';
    // Mongoose's isValidObjectId also accepts any 12-character string; require the canonical 24-hex form.
    if (typeof value !== 'string' || !OBJECT_ID.test(value)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.INVALID_ID,
        `${field} must be a valid id`,
        [
          {
            field,
            message: `${field} must be a 24-character hexadecimal ObjectId`,
          },
        ],
      );
    }
    return value;
  }
}

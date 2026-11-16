import { HttpStatus, Injectable, PipeTransform } from '@nestjs/common';
import { ProviderType } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

const TYPES: ReadonlySet<string> = new Set(Object.values(ProviderType));

/** `:type` in /api/admin/providers/:type/:id (ACC-15): `airline` or `hotel`, any letter case. */
@Injectable()
export class ParseProviderTypePipe implements PipeTransform<
  unknown,
  ProviderType
> {
  transform(value: unknown): ProviderType {
    // An exact match against the enum values, so keys like "constructor" can never slip through.
    const type = typeof value === 'string' ? value.toUpperCase() : '';
    if (!TYPES.has(type)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Validation failed',
        [{ field: 'type', message: 'type must be one of airline, hotel' }],
      );
    }
    return type as ProviderType;
  }
}

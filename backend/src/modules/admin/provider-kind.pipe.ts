import { Injectable, PipeTransform } from '@nestjs/common';
import { ValidationFailedException } from '../../common/errors/app.exception';

/** The `:type` segment of /api/admin/providers/:type/:id (ACC-15). */
export const PROVIDER_KINDS = ['airline', 'hotel'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** 400 with a `type` field error (GEN-02) unless the segment is exactly airline or hotel. */
@Injectable()
export class ParseProviderKindPipe implements PipeTransform<
  unknown,
  ProviderKind
> {
  transform(value: unknown): ProviderKind {
    if (PROVIDER_KINDS.includes(value as ProviderKind)) {
      return value as ProviderKind;
    }
    throw new ValidationFailedException([
      {
        field: 'type',
        message: `type must be one of ${PROVIDER_KINDS.join(', ')}`,
      },
    ]);
  }
}

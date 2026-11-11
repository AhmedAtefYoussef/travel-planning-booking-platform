import { Injectable, PipeTransform } from '@nestjs/common';
import type { BookingType } from '../../common/contracts';
import { ValidationFailedException } from '../../common/errors/app.exception';
import { BOOKING_TYPE_PATHS } from './booking-policies.service';

/** `flight` or `hotel` (case-insensitive) in the path -> BookingType; anything else is a 400. */
@Injectable()
export class ParseBookingTypePipe implements PipeTransform<
  unknown,
  BookingType
> {
  transform(value: unknown): BookingType {
    const type =
      typeof value === 'string'
        ? BOOKING_TYPE_PATHS[value.trim().toLowerCase()]
        : undefined;
    if (!type) {
      throw new ValidationFailedException([
        { field: 'type', message: 'type must be flight or hotel' },
      ]);
    }
    return type;
  }
}

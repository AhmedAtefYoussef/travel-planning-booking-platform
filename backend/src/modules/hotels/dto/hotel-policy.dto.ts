import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsWholeNumber, LOCAL_TIME_HH_MM } from '../../../common/validation';

const TIME_DESCRIPTION =
  '24-hour local time of the hotel, HH:mm from 00:00 to 23:59 (e.g. 14:00). Shown on the hotel page and the booking summary.';

/** At most this many tiers per hotel, the same cap as the airline policy (FLT-09). */
export const MAX_HOTEL_CANCELLATION_TIERS = 20;

/**
 * HTL-10: one tier. Cancelling at least `daysBefore` whole days before check-in refunds
 * `refundPercent` of the reservation total. Thresholds must be unique within the list; the service
 * checks that with the shared cancellationTierFieldErrors, as FLT-09 does.
 */
export class HotelCancellationTierDto {
  @ApiProperty({
    example: 7,
    minimum: 0,
    description:
      'Days before check-in (whole number >= 0), unique within the policy. Cancelling at least this many days ahead earns this tier.',
  })
  @IsWholeNumber('daysBefore must be a whole number of days')
  @Min(0)
  daysBefore!: number;

  @ApiProperty({
    example: 50,
    minimum: 0,
    maximum: 100,
    description:
      'Refund percentage of the reservation total, 0-100, up to two decimals',
  })
  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
    { message: 'refundPercent must be a number with up to two decimals' },
  )
  @Min(0)
  @Max(100)
  refundPercent!: number;
}

/**
 * HTL-09 + HTL-10: the hotel's whole policy, replaced by PUT /api/hotels/:id/policies.
 *
 * HTL-09: both times are required. Check-out is usually earlier in the day than check-in (12:00 out,
 * 14:00 in), so the two are not compared. One rule per field, so a missing or malformed time gives
 * one field error (GEN-02).
 *
 * HTL-10: the full tier list is required too, because PUT replaces the policy. An empty list means no
 * tier ever applies, so a user cancellation refunds 0% (the FLT-09 selection rule).
 */
export class SetHotelPoliciesDto {
  @ApiProperty({ example: '14:00', description: TIME_DESCRIPTION })
  @Matches(LOCAL_TIME_HH_MM, {
    message: 'checkInTime must be a 24-hour time HH:mm from 00:00 to 23:59',
  })
  checkInTime!: string;

  @ApiProperty({ example: '12:00', description: TIME_DESCRIPTION })
  @Matches(LOCAL_TIME_HH_MM, {
    message: 'checkOutTime must be a 24-hour time HH:mm from 00:00 to 23:59',
  })
  checkOutTime!: string;

  @ApiProperty({
    type: [HotelCancellationTierDto],
    maxItems: MAX_HOTEL_CANCELLATION_TIERS,
    example: [
      { daysBefore: 7, refundPercent: 100 },
      { daysBefore: 2, refundPercent: 50 },
    ],
    description:
      'HTL-10: the full list of cancellation tiers, replacing the previous one. Unique thresholds; [] means cancellations refund 0%.',
  })
  @IsArray({ message: 'cancellationTiers must be a list of tiers' })
  @ValidateNested({ each: true })
  @Type(() => HotelCancellationTierDto)
  cancellationTiers!: HotelCancellationTierDto[];
}

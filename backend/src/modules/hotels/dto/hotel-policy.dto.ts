import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { LOCAL_TIME_HH_MM } from '../../../common/validation';

const TIME_DESCRIPTION =
  '24-hour local time of the hotel, HH:mm from 00:00 to 23:59 (e.g. 14:00). Shown on the hotel page and the booking summary.';

/**
 * HTL-09: the hotel's standard check-in and check-out times. Both are required. Check-out is usually
 * earlier in the day than check-in (12:00 out, 14:00 in), so the two are not compared.
 * HTL-10 adds the cancellation tiers to the same PUT /api/hotels/:id/policies body.
 */
export class SetHotelPoliciesDto {
  @ApiProperty({ example: '14:00', description: TIME_DESCRIPTION })
  @IsString({ message: 'checkInTime must be a time written HH:mm' })
  @Matches(LOCAL_TIME_HH_MM, {
    message: 'checkInTime must be a 24-hour time HH:mm from 00:00 to 23:59',
  })
  checkInTime!: string;

  @ApiProperty({ example: '12:00', description: TIME_DESCRIPTION })
  @IsString({ message: 'checkOutTime must be a time written HH:mm' })
  @Matches(LOCAL_TIME_HH_MM, {
    message: 'checkOutTime must be a 24-hour time HH:mm from 00:00 to 23:59',
  })
  checkOutTime!: string;
}

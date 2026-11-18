import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';
import { ProviderType } from '../../../common/auth/auth.types';
import { BookingStatus, BookingType } from '../../../common/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { IsCalendarDate } from '../../hotels';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const TYPES = Object.values(BookingType);
const STATUSES = Object.values(BookingStatus);

/**
 * ACC-17: filters of the admin booking list. The date range is on the travel dates: a booking matches
 * when its trip (first departure to last arrival, or check-in day to the end of the check-out day)
 * overlaps the range, both ends included, in UTC calendar days.
 */
export class AdminBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: TYPES,
    description:
      'Flight bookings or hotel reservations only; both when left out',
  })
  @IsOptional()
  @Transform(upper)
  @IsEnum(BookingType, { message: `type must be one of ${TYPES.join(', ')}` })
  type?: BookingType;

  @ApiPropertyOptional({
    enum: STATUSES,
    description:
      'Only bookings in this GEN-11 status; every status when left out',
  })
  @IsOptional()
  @Transform(upper)
  @IsEnum(BookingStatus, {
    message: `status must be one of ${STATUSES.join(', ')}`,
  })
  status?: BookingStatus;

  @ApiPropertyOptional({
    example: '2028-06-01',
    description:
      'First day of the range (YYYY-MM-DD, UTC): trips that end on or after it',
  })
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @ApiPropertyOptional({
    example: '2028-06-30',
    description:
      'Last day of the range (YYYY-MM-DD, UTC), not before from: trips that start on or before it',
  })
  @IsOptional()
  @IsCalendarDate()
  to?: string;
}

export class AdminBookingUserDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    example: 'Mona Adel',
    description: '"Deleted user" when the account no longer exists',
  })
  name!: string;
  @ApiProperty({ nullable: true, type: String, example: 'mona@example.com' })
  email!: string | null;
}

export class AdminBookingProviderDto {
  @ApiProperty({ enum: Object.values(ProviderType) }) type!: ProviderType;
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'EgyptAir' }) name!: string;
}

/** ACC-17: one row of the admin's read-only booking list. */
export class AdminBookingDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: TYPES }) type!: BookingType;
  @ApiProperty({
    nullable: true,
    type: String,
    example: 'FL-7K3M9QX2',
    description: 'Null for an unpaid or expired hold',
  })
  reference!: string | null;
  @ApiProperty({ enum: STATUSES, description: 'Stored GEN-11 status' })
  status!: BookingStatus;
  @ApiProperty({ type: AdminBookingUserDto }) user!: AdminBookingUserDto;
  @ApiProperty({
    type: AdminBookingProviderDto,
    description: 'The airline of the (outbound) flight, or the hotel',
  })
  provider!: AdminBookingProviderDto;
  @ApiProperty({
    example: 'MS901 CAI -> DXB',
    description:
      'Flight numbers and route, or the rooms booked for a hotel reservation',
  })
  summary!: string;
  @ApiProperty({ description: 'First departure, or start of the check-in day' })
  startsAt!: Date;
  @ApiProperty({ description: 'Last arrival, or end of the check-out day' })
  endsAt!: Date;
  @ApiProperty({
    nullable: true,
    type: String,
    example: null,
    description: "Hotel's local check-in date; null for flights",
  })
  checkIn!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    example: null,
    description: "Hotel's local check-out date; null for flights",
  })
  checkOut!: string | null;
  @ApiProperty({ example: 115000, description: 'Minor units (PAY-04)' })
  totalMinor!: number;
  @ApiProperty({ example: 'EGP' }) currency!: string;
  @ApiProperty({ description: 'When the booking was made' }) createdAt!: Date;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';
import { ProviderType } from '../../../common/auth/auth.types';
import { BookingType } from '../../../common/contracts';
import { IsCalendarDate } from '../../hotels';

const TYPES = Object.values(BookingType);

/** BON-01: the period (travel dates, as in ACC-17) and the optional booking type of the analytics. */
export class AdminAnalyticsQueryDto {
  @ApiProperty({
    example: '2028-06-01',
    description:
      'First day of the period (YYYY-MM-DD, UTC): trips that end on or after it',
  })
  @IsCalendarDate()
  from!: string;

  @ApiProperty({
    example: '2028-06-30',
    description:
      'Last day of the period (YYYY-MM-DD, UTC), not before from and at most 366 days after it: trips that start on or before it',
  })
  @IsCalendarDate()
  to!: string;

  @ApiPropertyOptional({
    enum: TYPES,
    description:
      'Flight bookings or hotel reservations only; both when left out',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsEnum(BookingType, { message: `type must be one of ${TYPES.join(', ')}` })
  type?: BookingType;
}

export class AdminAnalyticsPeriodDto {
  @ApiProperty({ example: '2028-06-01' }) from!: string;
  @ApiProperty({ example: '2028-06-30' }) to!: string;
  @ApiProperty({
    enum: TYPES,
    nullable: true,
    example: null,
    description: 'The type filter; null when both types are included',
  })
  type!: BookingType | null;
}

/** The figures of one provider, or the sum over all providers in one currency. */
export class AdminAnalyticsFiguresDto {
  @ApiProperty({
    example: 12,
    description: 'Confirmed, completed and cancelled bookings in the period',
  })
  bookings!: number;
  @ApiProperty({ example: 10, description: 'Confirmed and completed' })
  confirmedBookings!: number;
  @ApiProperty({ example: 2, description: 'Cancelled' })
  cancelledBookings!: number;
  @ApiProperty({
    example: 1_200_000,
    description: 'Total of the paid bookings, minor units (PAY-04)',
  })
  grossRevenueMinor!: number;
  @ApiProperty({
    example: 100_000,
    description:
      'Refunds that reached REFUNDED for those bookings, minor units',
  })
  refundedMinor!: number;
  @ApiProperty({
    example: 1_100_000,
    description: 'grossRevenueMinor minus refundedMinor',
  })
  netRevenueMinor!: number;
  @ApiProperty({ example: 'EGP' }) currency!: string;
}

export class AdminAnalyticsProviderDto extends AdminAnalyticsFiguresDto {
  @ApiProperty({ enum: Object.values(ProviderType) })
  providerType!: ProviderType;
  @ApiProperty() providerId!: string;
  @ApiProperty({ example: 'EgyptAir' }) providerName!: string;
}

/** BON-01: bookings and revenue per provider over a period. */
export class AdminAnalyticsDto {
  @ApiProperty({ type: AdminAnalyticsPeriodDto })
  period!: AdminAnalyticsPeriodDto;
  @ApiProperty({
    type: [AdminAnalyticsProviderDto],
    description: 'Highest net revenue first',
  })
  providers!: AdminAnalyticsProviderDto[];
  @ApiProperty({
    type: [AdminAnalyticsFiguresDto],
    description:
      'The sum over all providers, one entry per currency (a single entry while the platform has one currency, PAY-04); empty when there are no bookings',
  })
  totals!: AdminAnalyticsFiguresDto[];
}

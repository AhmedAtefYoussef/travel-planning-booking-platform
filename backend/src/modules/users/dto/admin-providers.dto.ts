import { ApiProperty } from '@nestjs/swagger';
import { ProviderType } from '../../../common/auth/auth.types';

/** ACC-15: an airline or hotel after an admin deactivated or reactivated it. */
export class ProviderStatusDto {
  @ApiProperty({ example: '6730c5f1e4b0a1b2c3d4e5aa' })
  id!: string;

  @ApiProperty({ enum: ProviderType, example: ProviderType.Airline })
  type!: ProviderType;

  @ApiProperty({ example: 'EgyptAir' })
  name!: string;

  @ApiProperty({
    example: false,
    description:
      'false: hidden from search and cannot be booked; existing Confirmed bookings remain valid',
  })
  isActive!: boolean;
}

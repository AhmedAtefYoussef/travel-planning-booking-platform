import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsEmail,
  IsEnum,
  IsISO8601,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Role } from '../../../common/auth/auth.types';

export enum PassengerType {
  Adult = 'ADULT',
  Child = 'CHILD',
  Infant = 'INFANT',
}

export class DemoPassengerDto {
  @ApiProperty({ example: 'Ada Lovelace' })
  @IsString()
  @Length(2, 100)
  fullName!: string;

  @ApiProperty({ example: '1990-12-10', description: 'YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  dob!: string;

  @ApiProperty({ enum: PassengerType, example: PassengerType.Adult })
  @IsEnum(PassengerType)
  type!: PassengerType;
}

/** A booking-shaped payload to demonstrate nested field-level validation (GEN-02, GEN-13). */
export class DemoValidationDto {
  @ApiProperty({ example: 'traveller@example.com' })
  @IsEmail()
  contactEmail!: string;

  @ApiProperty({ type: [DemoPassengerDto] })
  @ValidateNested({ each: true })
  @Type(() => DemoPassengerDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(9)
  passengers!: DemoPassengerDto[];
}

export class DemoValidationResultDto {
  @ApiProperty({ example: true }) valid!: boolean;
  @ApiProperty({ example: 2 }) passengerCount!: number;
}

export class DemoItemDto {
  @ApiProperty({ example: 21 }) number!: number;
  @ApiProperty({ example: 'Sample row 21' }) label!: string;
}

export class DemoUniqueDto {
  @ApiProperty({
    example: 'TRVL-SAMPLE-1',
    description:
      'Unique key; submitting the same key twice returns 409 DUPLICATE_KEY',
  })
  @IsString()
  @Matches(/^[A-Z0-9-]{3,40}$/, {
    message: 'key must be 3-40 characters of A-Z, 0-9 or -',
  })
  key!: string;
}

export class DemoUniqueResultDto {
  @ApiProperty({ example: '6730c5f1e4b0a1b2c3d4e5f6' }) id!: string;
  @ApiProperty({ example: 'TRVL-SAMPLE-1' }) key!: string;
}

export class DemoPasswordDto {
  @ApiProperty({ example: 'Sup3r$ecret!', description: '1-72 bytes' })
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password!: string;
}

export class DemoPasswordResultDto {
  @ApiProperty({ example: '$2b$12$...' }) firstHash!: string;
  @ApiProperty({ example: '$2b$12$...' }) secondHash!: string;
  @ApiProperty({
    example: true,
    description: 'Each hash embeds its own random salt',
  })
  saltsDiffer!: boolean;
  @ApiProperty({ example: true }) bothVerify!: boolean;
  @ApiProperty({ example: false }) wrongPasswordVerifies!: boolean;
  @ApiProperty({ example: false }) containsPlainText!: boolean;
  @ApiProperty({ example: 12 }) workFactor!: number;
}

export class DemoCallerDto {
  @ApiProperty({ example: '000000000000000000000001' }) id!: string;
  @ApiProperty({ enum: Role, example: Role.User }) role!: Role;
  @ApiProperty({
    required: false,
    example: { type: 'HOTEL', providerId: '0000000000000000000000aa' },
  })
  assignedProvider?: { type: string; providerId: string };
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ErrorCode } from './error-codes';

export class FieldErrorDto {
  @ApiProperty({ example: 'passengers[0].dob' })
  field!: string;

  @ApiProperty({ example: 'dob must be a valid ISO 8601 date string' })
  message!: string;
}

/** The single error shape returned by every endpoint (AllExceptionsFilter, GEN-02). */
export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({ example: 'Bad Request' })
  error!: string;

  @ApiProperty({
    enum: Object.values(ErrorCode),
    example: ErrorCode.VALIDATION_FAILED,
  })
  code!: ErrorCode;

  @ApiProperty({ example: 'Validation failed' })
  message!: string;

  @ApiPropertyOptional({ type: [FieldErrorDto] })
  fieldErrors?: FieldErrorDto[];

  @ApiProperty({ example: '/api/flight-bookings/hold' })
  path!: string;

  @ApiProperty({ example: '2026-11-08T10:15:30.000Z' })
  timestamp!: string;
}

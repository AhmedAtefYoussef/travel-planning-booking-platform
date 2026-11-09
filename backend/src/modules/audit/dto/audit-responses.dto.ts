import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Documentation-only response shapes. */
export class AuditLogItemDto {
  @ApiProperty({ example: '64b7f0c2a1b2c3d4e5f6071b' }) _id: string;
  @ApiProperty({
    type: String,
    nullable: true,
    example: '64b7f0c2a1b2c3d4e5f60718',
  })
  actorId: string | null;
  @ApiProperty({ example: 'payment.succeeded' }) action: string;
  @ApiProperty({ example: 'payment' }) targetType: string;
  @ApiProperty({ example: '64b7f0c2a1b2c3d4e5f60719' }) targetId: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  metadata?: Record<string, unknown>;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export class AuditPageDto {
  @ApiProperty({ type: [AuditLogItemDto] }) items: AuditLogItemDto[];
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 42 }) total: number;
  @ApiProperty({ example: 5 }) totalPages: number;
}

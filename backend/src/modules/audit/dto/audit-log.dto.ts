import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../../../common/auth/auth.types';
import { AuditAction, AuditTargetType } from '../../../common/contracts';

export class AuditActorDto {
  @ApiProperty({ example: '6730c5f1e4b0a1b2c3d4e5f6' })
  id!: string;

  @ApiProperty({ enum: Role, example: Role.Admin })
  role!: Role;
}

/** One audit log entry (GEN-07). Mirrors AuditEntry plus id and createdAt; secrets were stripped at write time. */
export class AuditLogDto {
  @ApiProperty({ example: '6af0f1c2c77901aa9f228700' })
  id!: string;

  @ApiProperty({ enum: AuditAction, example: AuditAction.ResetPassword })
  action!: AuditAction;

  @ApiProperty({ type: AuditActorDto })
  actor!: AuditActorDto;

  @ApiProperty({ enum: AuditTargetType, example: AuditTargetType.User })
  targetType!: AuditTargetType;

  @ApiProperty({ example: '6730c5f1e4b0a1b2c3d4e5aa' })
  targetId!: string;

  @ApiPropertyOptional({ example: 'Repeated spam reports', maxLength: 500 })
  reason?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { previousStatus: 'ACTIVE' },
    description: 'Small before/after summary',
  })
  metadata?: Record<string, unknown>;

  @ApiProperty({ example: '2026-11-16T10:15:30.000Z' })
  createdAt!: Date;
}

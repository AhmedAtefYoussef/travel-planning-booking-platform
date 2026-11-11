import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, Matches, ValidateBy } from 'class-validator';
import { Role } from '../../../common/auth/auth.types';
import { AuditAction, AuditTargetType } from '../../../common/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

const ACTIONS = Object.values(AuditAction);
const TARGET_TYPES = Object.values(AuditTargetType);
const OBJECT_ID = /^[a-f0-9]{24}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** True for 2026-11-10 or 2026-11-10T08:30:00Z when it is also a real calendar date. */
export function isAuditInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!DATE_ONLY.test(value) && !DATE_TIME.test(value)) return false;
  const day = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return (
    !Number.isNaN(day.getTime()) &&
    day.toISOString().slice(0, 10) === value.slice(0, 10) &&
    !Number.isNaN(Date.parse(value))
  );
}

/** One rule, one message per field (GEN-02). */
function IsAuditInstant(field: string) {
  return ValidateBy({
    name: 'isAuditInstant',
    validator: {
      validate: isAuditInstant,
      defaultMessage: () =>
        `${field} must be a date (2026-11-10) or a date and time with a zone (2026-11-10T08:30:00Z)`,
    },
  });
}

/** GEN-07 filters; all optional and combined with AND. */
export class AuditLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ACTIONS, description: 'Only this action' })
  @IsOptional()
  @Transform(upper)
  @IsIn(ACTIONS, { message: `action must be one of: ${ACTIONS.join(', ')}` })
  action?: AuditAction;

  @ApiPropertyOptional({
    enum: TARGET_TYPES,
    description: 'Only actions on this kind of target',
  })
  @IsOptional()
  @Transform(upper)
  @IsIn(TARGET_TYPES, {
    message: `targetType must be one of: ${TARGET_TYPES.join(', ')}`,
  })
  targetType?: AuditTargetType;

  @ApiPropertyOptional({
    example: '6af0ea42c77901aa9f22864e',
    description: 'Only actions on this record (user, provider, post, ...)',
  })
  @IsOptional()
  @Transform(lower)
  @Matches(OBJECT_ID, {
    message: 'targetId must be a 24-character hexadecimal id',
  })
  targetId?: string;

  @ApiPropertyOptional({
    example: '6af0ea42c77901aa9f228650',
    description: 'Only actions performed by this admin',
  })
  @IsOptional()
  @Transform(lower)
  @Matches(OBJECT_ID, {
    message: 'actorId must be a 24-character hexadecimal id',
  })
  actorId?: string;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description:
      'Only entries at or after this instant. A date alone means the start of that day (UTC).',
  })
  @IsOptional()
  @IsAuditInstant('from')
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description:
      'Only entries up to this instant. A date alone includes the whole day (UTC); a date and time is inclusive. Must not be before `from`.',
  })
  @IsOptional()
  @IsAuditInstant('to')
  to?: string;
}

/** One audit entry as admins read it (GEN-07). */
export class AuditLogDto {
  @ApiProperty({ example: '6af38e1e4cf2afc30dd86538' })
  id!: string;

  @ApiProperty({
    example: '6af0ea42c77901aa9f228650',
    description: 'The admin who performed the action',
  })
  actorId!: string;

  @ApiProperty({ enum: Object.values(Role), example: Role.Admin })
  actorRole!: Role;

  @ApiProperty({ enum: ACTIONS, example: AuditAction.SuspendAccount })
  action!: AuditAction;

  @ApiProperty({ enum: TARGET_TYPES, example: AuditTargetType.User })
  targetType!: AuditTargetType;

  @ApiProperty({ example: '6af0ea42c77901aa9f22864e' })
  targetId!: string;

  @ApiProperty({
    example: 'Repeated spam in comments',
    nullable: true,
    type: String,
    description: 'The reason the admin gave, when the action takes one',
  })
  reason!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { before: { status: 'ACTIVE' }, after: { status: 'SUSPENDED' } },
    description:
      'Small before/after summary. Secret-looking keys are removed before an entry is stored.',
  })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({ example: '2026-11-10T09:15:27.412Z' })
  createdAt!: Date;
}

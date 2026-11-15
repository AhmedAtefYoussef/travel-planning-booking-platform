import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  Matches,
  ValidateBy,
} from 'class-validator';
import { AuditAction, AuditTargetType } from '../../../common/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** `from` must not be later than `to`; reported on `from` (GEN-02 field-level error). */
function NotAfterTo() {
  return ValidateBy({
    name: 'notAfterTo',
    validator: {
      validate: (value: unknown, args) => {
        const to = (args?.object as { to?: unknown }).to;
        if (typeof value !== 'string' || typeof to !== 'string') return true;
        const [a, b] = [Date.parse(value), Date.parse(to)];
        return Number.isNaN(a) || Number.isNaN(b) || a <= b;
      },
      defaultMessage: () => 'from must not be later than to',
    },
  });
}

/** GEN-07 audit log list: filters plus page only (fixed size 10, GEN-05). */
export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: AuditAction,
    example: AuditAction.ResetPassword,
    description: 'Only entries of this action',
  })
  @IsOptional()
  @Transform(upper)
  @IsEnum(AuditAction, {
    message: `action must be one of ${Object.values(AuditAction).join(', ')}`,
  })
  action?: AuditAction;

  @ApiPropertyOptional({
    enum: AuditTargetType,
    example: AuditTargetType.User,
    description: 'Only entries about this kind of target',
  })
  @IsOptional()
  @Transform(upper)
  @IsEnum(AuditTargetType, {
    message: `targetType must be one of ${Object.values(AuditTargetType).join(', ')}`,
  })
  targetType?: AuditTargetType;

  @ApiPropertyOptional({
    example: '6730c5f1e4b0a1b2c3d4e5f6',
    description: 'Only entries made by this account (admin or moderator id)',
  })
  @IsOptional()
  @Matches(/^[a-f0-9]{24}$/i, {
    message: 'actorId must be a 24-character hexadecimal id',
  })
  actorId?: string;

  @ApiPropertyOptional({
    example: '2026-11-01T00:00:00Z',
    description:
      'Earliest entry time, ISO-8601, inclusive. A date alone means 00:00 UTC. Must not be later than to.',
  })
  @IsOptional()
  @IsISO8601(
    { strict: true },
    { message: 'from must be an ISO-8601 date or date-time' },
  )
  @NotAfterTo()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-30T23:59:59Z',
    description: 'Latest entry time, ISO-8601, inclusive',
  })
  @IsOptional()
  @IsISO8601(
    { strict: true },
    { message: 'to must be an ISO-8601 date or date-time' },
  )
  to?: string;
}

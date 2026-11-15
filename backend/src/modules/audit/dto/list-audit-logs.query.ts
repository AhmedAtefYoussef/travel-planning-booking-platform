import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, Matches, ValidateBy } from 'class-validator';
import { AuditAction, AuditTargetType } from '../../../common/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_ZONED =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** A date-only value (YYYY-MM-DD) means the whole UTC day; a date-time must carry its zone. */
export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value);
}

/** Parses an accepted timestamp, or returns null (wrong form, or not a real date such as 2026-02-31). */
export function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  if (!DATE_ONLY.test(value) && !DATE_TIME_ZONED.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  if (DATE_ONLY.test(value) && date.toISOString().slice(0, 10) !== value)
    return null;
  return date;
}

/** Exclusive upper bound for a "to": next 00:00 UTC for a date-only value, the instant itself otherwise. */
export function upperBound(to: string): { op: '$lt' | '$lte'; at: Date } {
  const at = new Date(parseTimestamp(to)!);
  if (!isDateOnly(to)) return { op: '$lte', at };
  at.setUTCDate(at.getUTCDate() + 1);
  return { op: '$lt', at };
}

function IsTimestamp(field: string) {
  return ValidateBy({
    name: 'isTimestamp',
    validator: {
      validate: (value: unknown) => parseTimestamp(value) !== null,
      defaultMessage: () =>
        `${field} must be a date (YYYY-MM-DD) or an ISO-8601 date-time with a zone (Z or +hh:mm)`,
    },
  });
}

/** `from` must not be later than `to`; reported on `from` (GEN-02 field-level error). */
function NotAfterTo() {
  return ValidateBy({
    name: 'notAfterTo',
    validator: {
      validate: (value: unknown, args) => {
        const to = (args?.object as { to?: unknown }).to;
        const from = parseTimestamp(value);
        if (!from || parseTimestamp(to) === null) return true;
        const bound = upperBound(to as string);
        return bound.op === '$lt' ? from < bound.at : from <= bound.at;
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
      'Earliest entry time, inclusive: YYYY-MM-DD (00:00 UTC that day) or an ISO-8601 date-time with a zone (Z or +hh:mm). Must not be later than to.',
  })
  @IsOptional()
  @IsTimestamp('from')
  @NotAfterTo()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-30T23:59:59Z',
    description:
      'Latest entry time: YYYY-MM-DD includes that whole UTC day; an ISO-8601 date-time with a zone (Z or +hh:mm) is inclusive of that instant',
  })
  @IsOptional()
  @IsTimestamp('to')
  to?: string;
}

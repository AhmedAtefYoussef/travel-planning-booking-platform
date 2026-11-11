import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import type { AuditEntry, AuditService } from '../../common/contracts';
import { ValidationFailedException } from '../../common/errors/app.exception';
import { paginate, type Page } from '../../common/pagination/pagination';
import type { AuditLogDto, AuditLogQueryDto } from './dto/audit-log.dto';
import { AuditLog } from './schemas/audit-log.schema';

// guard-rails: allow no-raw-card-data - redaction pattern that strips card-like keys from audit metadata
const SENSITIVE_KEY = /pass(word)?|secret|token|hash|card|cvc|cvv/i;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Drops secret-looking keys so an audit entry can never leak credentials. */
export function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  // Too deep to inspect safely: drop it rather than risk storing an unchecked secret.
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value))
    return value.map((v) => sanitizeMetadata(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .map(([key, v]) => [key, sanitizeMetadata(v, depth + 1)]),
  );
}

/**
 * The createdAt range of the GEN-07 filters. A date alone means a whole UTC day: `from` starts at
 * its first instant and `to` includes it to its last. A date and time is used as given (inclusive).
 */
export function auditDateRange(
  from?: string,
  to?: string,
): { $gte?: Date; $lt?: Date; $lte?: Date } | undefined {
  if (!from && !to) return undefined;
  const range: { $gte?: Date; $lt?: Date; $lte?: Date } = {};
  if (from) {
    range.$gte = new Date(
      DATE_ONLY.test(from) ? `${from}T00:00:00.000Z` : from,
    );
  }
  if (to) {
    if (DATE_ONLY.test(to)) {
      range.$lt = new Date(Date.parse(`${to}T00:00:00.000Z`) + DAY_MS);
    } else {
      range.$lte = new Date(to);
    }
  }
  const start = range.$gte?.getTime();
  const empty =
    start !== undefined &&
    ((range.$lt !== undefined && start >= range.$lt.getTime()) ||
      (range.$lte !== undefined && start > range.$lte.getTime()));
  if (empty) {
    throw new ValidationFailedException([
      { field: 'to', message: 'to must not be before from' },
    ]);
  }
  return range;
}

interface StoredAuditLog {
  _id: Types.ObjectId;
  actorId: Types.ObjectId;
  actorRole: AuditLog['actorRole'];
  action: AuditLog['action'];
  targetType: AuditLog['targetType'];
  targetId: Types.ObjectId;
  reason?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export function toAuditLogDto(doc: StoredAuditLog): AuditLogDto {
  return {
    id: doc._id.toHexString(),
    actorId: doc.actorId.toHexString(),
    actorRole: doc.actorRole,
    action: doc.action,
    targetType: doc.targetType,
    targetId: doc.targetId.toHexString(),
    reason: doc.reason ?? null,
    metadata: doc.metadata ?? null,
    createdAt: doc.createdAt,
  };
}

/** AUDIT_SERVICE implementation (GEN-07), plus the admin read side. */
@Injectable()
export class AuditLogService implements AuditService {
  constructor(
    @InjectModel(AuditLog.name) private readonly model: Model<AuditLog>,
  ) {}

  async record(entry: AuditEntry, session?: ClientSession): Promise<void> {
    await this.model.create(
      [
        {
          actorId: new Types.ObjectId(entry.actor.id),
          actorRole: entry.actor.role,
          action: entry.action,
          targetType: entry.targetType,
          targetId: new Types.ObjectId(entry.targetId),
          reason: entry.reason,
          metadata: entry.metadata
            ? sanitizeMetadata(entry.metadata)
            : undefined,
        },
      ],
      { session },
    );
  }

  /**
   * GET /api/admin/audit-logs: newest first, page size 10 (GEN-05), every filter optional and
   * combined with AND. Read-only: the collection itself refuses updates and deletes.
   */
  async list(query: AuditLogQueryDto): Promise<Page<AuditLogDto>> {
    const filter: FilterQuery<AuditLog> = {};
    if (query.action) filter.action = query.action;
    if (query.targetType) filter.targetType = query.targetType;
    if (query.targetId) filter.targetId = new Types.ObjectId(query.targetId);
    if (query.actorId) filter.actorId = new Types.ObjectId(query.actorId);
    const createdAt = auditDateRange(query.from, query.to);
    if (createdAt) filter.createdAt = createdAt;

    const page = await paginate(this.model, filter, query.page, {
      sort: { createdAt: -1 },
    });
    return {
      ...page,
      items: (page.items as unknown as StoredAuditLog[]).map(toAuditLogDto),
    };
  }
}

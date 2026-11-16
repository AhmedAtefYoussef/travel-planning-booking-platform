import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import type { AuditEntry, AuditService } from '../../common/contracts';
import { paginate, type Page } from '../../common/pagination/pagination';
import type { AuditLogDto } from './dto/audit-log.dto';
import {
  parseTimestamp,
  upperBound,
  type ListAuditLogsQueryDto,
} from './dto/list-audit-logs.query';
import { AuditLog } from './schemas/audit-log.schema';

// guard-rails: allow no-raw-card-data - redaction pattern that strips card-like keys from audit metadata
const SENSITIVE_KEY = /pass(word)?|secret|token|hash|card|cvc|cvv/i;

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

/** AUDIT_SERVICE implementation (GEN-07). */
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

  /** GEN-07: newest first (createdAt, then _id), 10 per page; filters combine. */
  async list(query: ListAuditLogsQueryDto): Promise<Page<AuditLogDto>> {
    const filter: FilterQuery<AuditLog> = {};
    if (query.action) filter.action = query.action;
    if (query.targetType) filter.targetType = query.targetType;
    if (query.actorId) filter.actorId = new Types.ObjectId(query.actorId);
    if (query.from || query.to) {
      const range: Record<string, Date> = {};
      if (query.from) range.$gte = parseTimestamp(query.from)!;
      if (query.to) {
        const { op, at } = upperBound(query.to);
        range[op] = at;
      }
      filter.createdAt = range;
    }
    const page = await paginate(this.model, filter, query.page, {
      sort: { createdAt: -1 },
    });
    return { ...page, items: page.items.map(toDto) };
  }
}

function toDto(doc: AuditLog & { _id: Types.ObjectId }): AuditLogDto {
  return {
    id: doc._id.toHexString(),
    action: doc.action,
    actor: { id: doc.actorId.toHexString(), role: doc.actorRole },
    targetType: doc.targetType,
    targetId: doc.targetId.toHexString(),
    ...(doc.reason !== undefined && { reason: doc.reason }),
    ...(doc.metadata != null && {
      metadata: sanitizeMetadata(doc.metadata) as Record<string, unknown>,
    }),
    createdAt: doc.createdAt,
  };
}

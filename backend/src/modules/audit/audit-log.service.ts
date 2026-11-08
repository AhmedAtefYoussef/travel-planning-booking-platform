import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import type { AuditEntry, AuditService } from '../../common/contracts';
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
}

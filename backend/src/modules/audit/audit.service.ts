import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AuditEntry,
  AuditService as AuditServiceContract,
} from '../../common/contracts/audit.contract';
import {
  PaginatedResponse,
  pageOffset,
  paginate,
} from '../../common/dto/pagination.dto';
import { AuditQueryDto } from './audit-query.dto';
import { AuditLog } from './audit-log.schema';

/** Write + read only. There is deliberately no update or delete method. */
@Injectable()
export class AuditService implements AuditServiceContract {
  constructor(
    @InjectModel(AuditLog.name) private readonly model: Model<AuditLog>,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.model.create({
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata,
    });
  }

  async list(query: AuditQueryDto): Promise<PaginatedResponse<unknown>> {
    const filter: Record<string, unknown> = {};
    if (query.actorId) filter.actorId = query.actorId;
    if (query.action) filter.action = query.action;
    if (query.from || query.to) {
      const range: Record<string, Date> = {};
      if (query.from) range.$gte = new Date(query.from);
      if (query.to) range.$lte = new Date(query.to);
      filter.createdAt = range;
    }
    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(pageOffset(query.page, query.limit))
        .limit(query.limit)
        .lean()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return paginate(items, total, query.page, query.limit);
  }
}

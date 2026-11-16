import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { AuthUser } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { ContentRegistryService } from './content-registry.service';
import type { CreateReportDto, ReportDto } from './dto/report.dto';
import { Report } from './schemas/report.schema';

/** One body for every "cannot report this" case, so a hidden item is indistinguishable from none. */
const CONTENT_NOT_FOUND = 'Content not found';

export function contentNotFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    CONTENT_NOT_FOUND,
  );
}

export function toReportDto(doc: Report & { _id: Types.ObjectId }): ReportDto {
  return {
    id: doc._id.toHexString(),
    reporterId: doc.reporterId.toHexString(),
    targetType: doc.targetType,
    targetId: doc.targetId.toHexString(),
    reason: doc.reason,
    status: doc.status,
    resolution: doc.resolution
      ? {
          action: doc.resolution.action,
          adminId: doc.resolution.adminId.toHexString(),
          at: doc.resolution.at.toISOString(),
        }
      : null,
    createdAt: doc.createdAt.toISOString(),
  };
}

function isDuplicateKey(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === 11000
  );
}

/**
 * GEN-09: a registered user reports a post, comment, review or itinerary, at most once per item.
 * The item is resolved through its module's adapter: no adapter, no item, or an item hidden from the
 * reporter (GEN-10: hidden content is visible only to its author and admins) is one identical 404.
 * Authors may report their own content; the spec does not forbid it.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Report.name) private readonly reports: Model<Report>,
    private readonly registry: ContentRegistryService,
  ) {}

  async create(reporter: AuthUser, dto: CreateReportDto): Promise<ReportDto> {
    const adapter = this.registry.adapterFor(dto.targetType);
    const content = adapter ? await adapter.find(dto.targetId) : null;
    if (!content || (content.hidden && content.ownerId !== reporter.id)) {
      throw contentNotFound();
    }
    try {
      const doc = await this.reports.create({
        reporterId: new Types.ObjectId(reporter.id),
        targetType: dto.targetType,
        targetId: new Types.ObjectId(dto.targetId),
        reason: dto.reason,
      });
      return toReportDto(doc.toObject());
    } catch (e) {
      // The unique (reporterId, targetType, targetId) index is the once-per-item rule, race-free.
      if (isDuplicateKey(e)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.DUPLICATE_KEY,
          'You have already reported this item',
        );
      }
      throw e;
    }
  }
}

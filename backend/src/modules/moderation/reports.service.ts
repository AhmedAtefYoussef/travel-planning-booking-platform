import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  CONTENT_MODERATION,
  isContentVisibleTo,
  type ContentModeration,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { CreateReportDto, ReportDto } from './dto/report.dto';
import { Report } from './schemas/report.schema';

const DUPLICATE_KEY = 11000;

/** One answer for an unknown id, an unregistered type and content the reporter cannot see. */
export const REPORT_TARGET_NOT_FOUND = 'The reported content was not found';

function isDuplicateReport(e: unknown): boolean {
  const err = e as { code?: unknown; keyPattern?: Record<string, unknown> };
  return err?.code === DUPLICATE_KEY && !!err.keyPattern?.reporterId;
}

/**
 * GEN-09: a registered user reports a post, comment, review or itinerary with a reason, at most once per
 * item. The unique index (reporterId, targetType, targetId) is the rule, so two simultaneous reports
 * still end with one document and one 409. Admin review is GEN-10.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Report.name) private readonly reports: Model<Report>,
    @Inject(CONTENT_MODERATION) private readonly content: ContentModeration,
  ) {}

  async report(user: AuthUser, dto: CreateReportDto): Promise<ReportDto> {
    const target = await this.content.get(dto.targetType)?.find(dto.targetId);
    if (!target || !isContentVisibleTo(target, user.id)) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        REPORT_TARGET_NOT_FOUND,
      );
    }
    try {
      const report = await this.reports.create({
        reporterId: new Types.ObjectId(user.id),
        targetType: dto.targetType,
        targetId: new Types.ObjectId(target.id),
        reason: dto.reason,
      });
      return {
        id: report._id.toHexString(),
        targetType: report.targetType,
        targetId: target.id,
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt,
      };
    } catch (e) {
      if (isDuplicateReport(e)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.REPORT_ALREADY_FILED,
          'You have already reported this item',
        );
      }
      throw e;
    }
  }
}

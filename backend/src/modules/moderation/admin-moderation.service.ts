import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, FilterQuery, Model } from 'mongoose';
import { Types } from 'mongoose';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  AUDIT_SERVICE,
  AuditAction,
  AuditTargetType,
  CONTENT_MODERATION,
  ModeratableContentType,
  type AuditService,
  type ContentModeration,
  type RemovedContent,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { paginate, type Page } from '../../common/pagination/pagination';
import {
  ReportAction,
  type AdminReportDto,
  type ContentModerationResultDto,
  type ListReportsQueryDto,
  type ResolvedReportDto,
  type ResolveReportDto,
} from './dto/admin-moderation.dto';
import { Report, ReportStatus } from './schemas/report.schema';

const AUDIT_TARGET: Record<ModeratableContentType, AuditTargetType> = {
  [ModeratableContentType.Post]: AuditTargetType.Post,
  [ModeratableContentType.Comment]: AuditTargetType.Comment,
  [ModeratableContentType.Review]: AuditTargetType.Review,
  [ModeratableContentType.Itinerary]: AuditTargetType.Itinerary,
};

const OUTCOME: Record<ReportAction, ReportStatus> = {
  [ReportAction.Dismiss]: ReportStatus.Dismissed,
  [ReportAction.Hide]: ReportStatus.Hidden,
  [ReportAction.Delete]: ReportStatus.Deleted,
};

type ReportRow = Report & { _id: Types.ObjectId };
type Resolution = {
  status: ReportStatus;
  resolvedBy: Types.ObjectId;
  resolvedAt: Date;
  resolutionNote?: string;
};

const notFound = (what: string) =>
  new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, what);

/**
 * GEN-10: an admin reviews open reports and resolves each by dismissing it, hiding or deleting the
 * content; or hides or deletes any post, comment, review or itinerary directly. Every change runs in ONE
 * transaction together with its GEN-07 audit entries; the report update is conditioned on OPEN, so two
 * admins can never both resolve one report. Content is reached only through CONTENT_MODERATION adapters.
 */
@Injectable()
export class AdminModerationService {
  private readonly logger = new Logger(AdminModerationService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Report.name) private readonly reports: Model<Report>,
    @Inject(CONTENT_MODERATION) private readonly content: ContentModeration,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /** GEN-10 queue: OPEN by default, newest first, 10 per page (GEN-05). */
  async list(query: ListReportsQueryDto): Promise<Page<AdminReportDto>> {
    const filter: FilterQuery<Report> = {
      status: query.status ?? ReportStatus.Open,
    };
    if (query.targetType) filter.targetType = query.targetType;
    const page = await paginate(this.reports, filter, query.page, {
      sort: { createdAt: -1 },
    });
    return { ...page, items: (page.items as ReportRow[]).map(toAdminReport) };
  }

  async resolve(
    actor: AuthUser,
    reportId: string,
    dto: ResolveReportDto,
  ): Promise<ResolvedReportDto> {
    const resolution = this.resolution(actor, OUTCOME[dto.action], dto.note);
    let removed: RemovedContent | null = null;
    const result = await this.connection.transaction(async (session) => {
      removed = null;
      const report = await this.reports
        .findOneAndUpdate(
          { _id: reportId, status: ReportStatus.Open },
          { $set: resolution },
          { session, new: true },
        )
        .lean<ReportRow>()
        .exec();
      if (!report) {
        const exists = await this.reports
          .exists({ _id: reportId })
          .session(session)
          .exec();
        if (!exists) throw notFound('Report not found');
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.REPORT_ALREADY_RESOLVED,
          'This report has already been resolved',
        );
      }
      const targetId = report.targetId.toHexString();
      let others = 0;
      if (dto.action !== ReportAction.Dismiss) {
        const applied = await this.applyToContent(
          actor,
          report.targetType,
          targetId,
          dto.action,
          { explicit: false, reportId, note: dto.note },
          resolution,
          session,
        );
        removed = applied.removed;
        others = applied.reportsResolved;
      }
      await this.audit.record(
        {
          actor: { id: actor.id, role: actor.role },
          action: AuditAction.ResolveReport,
          targetType: AuditTargetType.Report,
          targetId: reportId,
          reason: dto.note,
          metadata: {
            resolution: resolution.status,
            contentType: report.targetType,
            contentId: targetId,
            otherReportsResolved: others,
          },
        },
        session,
      );
      return { ...toAdminReport(report), otherReportsResolved: others };
    });
    await this.afterCommit(removed);
    return result;
  }

  /** Direct hide (GEN-10): hidden content already hidden is 409, an explicit no-op. */
  hide(
    actor: AuthUser,
    type: ModeratableContentType,
    id: string,
  ): Promise<ContentModerationResultDto> {
    return this.direct(actor, type, id, ReportAction.Hide);
  }

  /** Direct delete (GEN-10). */
  remove(
    actor: AuthUser,
    type: ModeratableContentType,
    id: string,
  ): Promise<ContentModerationResultDto> {
    return this.direct(actor, type, id, ReportAction.Delete);
  }

  private async direct(
    actor: AuthUser,
    type: ModeratableContentType,
    id: string,
    action: ReportAction.Hide | ReportAction.Delete,
  ): Promise<ContentModerationResultDto> {
    const resolution = this.resolution(actor, OUTCOME[action]);
    let removed: RemovedContent | null = null;
    const result = await this.connection.transaction(async (session) => {
      const applied = await this.applyToContent(
        actor,
        type,
        id,
        action,
        { explicit: true },
        resolution,
        session,
      );
      removed = applied.removed;
      return {
        targetType: type,
        targetId: id,
        outcome: resolution.status,
        reportsResolved: applied.reportsResolved,
      };
    });
    await this.afterCommit(removed);
    return result;
  }

  /**
   * Hides or deletes through the adapter, closes the item's OPEN reports with the same outcome and audits
   * it (with the number of reports closed). Missing content or an unregistered type is 404. Hiding hidden
   * content: 409 when `explicit`, otherwise the reports close without a second HIDE_CONTENT entry.
   */
  private async applyToContent(
    actor: AuthUser,
    type: ModeratableContentType,
    id: string,
    action: ReportAction.Hide | ReportAction.Delete,
    context: { explicit: boolean; reportId?: string; note?: string },
    resolution: Resolution,
    session: ClientSession,
  ): Promise<{ removed: RemovedContent | null; reportsResolved: number }> {
    const adapter = this.content.get(type);
    const content = await adapter?.find(id, session);
    if (!adapter || !content) throw notFound('The content was not found');
    let removed: RemovedContent | null = null;
    if (action === ReportAction.Hide) {
      const changed = await adapter.setHidden(id, true, session);
      if (!changed) {
        if (context.explicit) {
          throw new AppException(
            HttpStatus.CONFLICT,
            ErrorCode.CONTENT_ALREADY_HIDDEN,
            'This content is already hidden',
          );
        }
        const reportsResolved = await this.closeOpenReports(
          type,
          id,
          resolution,
          session,
        );
        return { removed, reportsResolved };
      }
    } else {
      removed = await adapter.remove(id, session);
      if (!removed) throw notFound('The content was not found');
    }
    const reportsResolved = await this.closeOpenReports(
      type,
      id,
      resolution,
      session,
    );
    await this.audit.record(
      {
        actor: { id: actor.id, role: actor.role },
        action:
          action === ReportAction.Hide
            ? AuditAction.HideContent
            : AuditAction.DeleteContent,
        targetType: AUDIT_TARGET[type],
        targetId: id,
        reason: context.note,
        metadata: {
          authorId: content.authorId,
          reportId: context.reportId,
          reportsResolved,
        },
      },
      session,
    );
    return { removed, reportsResolved };
  }

  /** Closes every OPEN report of the item with the same outcome; the documents stay for the audit trail. */
  private async closeOpenReports(
    type: ModeratableContentType,
    id: string,
    resolution: Resolution,
    session: ClientSession,
  ): Promise<number> {
    const res = await this.reports
      .updateMany(
        {
          targetType: type,
          targetId: new Types.ObjectId(id),
          status: ReportStatus.Open,
        },
        { $set: resolution },
        { session },
      )
      .exec();
    return res.modifiedCount;
  }

  private resolution(
    actor: AuthUser,
    status: ReportStatus,
    note?: string,
  ): Resolution {
    return {
      status,
      resolvedBy: new Types.ObjectId(actor.id),
      resolvedAt: new Date(),
      ...(note ? { resolutionNote: note } : {}),
    };
  }

  /** Cleanup outside the transaction (files, session-less ports): logged, never an error for the admin. */
  private async afterCommit(removed: RemovedContent | null): Promise<void> {
    if (!removed) return;
    try {
      await removed.afterCommit();
    } catch (e) {
      this.logger.error(
        `Cleanup after deleting moderated content failed: ${(e as Error).message}`,
        (e as Error).stack,
      );
    }
  }
}

function toAdminReport(r: ReportRow): AdminReportDto {
  return {
    id: r._id.toHexString(),
    targetType: r.targetType,
    targetId: r.targetId.toHexString(),
    reason: r.reason,
    status: r.status,
    reporterId: r.reporterId.toHexString(),
    createdAt: r.createdAt,
    resolvedBy: r.resolvedBy ? r.resolvedBy.toHexString() : null,
    resolvedAt: r.resolvedAt ?? null,
    ...(r.resolutionNote ? { resolutionNote: r.resolutionNote } : {}),
  };
}

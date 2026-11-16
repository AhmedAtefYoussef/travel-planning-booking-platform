import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  Types,
  type ClientSession,
  type Connection,
  type Model,
} from 'mongoose';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  AUDIT_SERVICE,
  AuditAction,
  AuditTargetType,
  ModeratableContentType,
  type AuditService,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { paginate, type Page } from '../../common/pagination/pagination';
import { ContentRegistryService } from './content-registry.service';
import type {
  ListReportsQueryDto,
  ModerationResultDto,
} from './dto/moderation.dto';
import type { ReportDto } from './dto/report.dto';
import { contentNotFound, toReportDto } from './reports.service';
import {
  Report,
  ReportAction,
  ReportStatus,
  type ReportResolution,
} from './schemas/report.schema';

const AUDIT_TARGET: Record<ModeratableContentType, AuditTargetType> = {
  [ModeratableContentType.Post]: AuditTargetType.Post,
  [ModeratableContentType.Comment]: AuditTargetType.Comment,
  [ModeratableContentType.Review]: AuditTargetType.Review,
  [ModeratableContentType.Itinerary]: AuditTargetType.Itinerary,
};

type ContentAction = ReportAction.Hide | ReportAction.Delete;

interface ContentTarget {
  type: ModeratableContentType;
  id: string;
}

/** How a content action was started: from a report (409 when the item is gone) or directly (404). */
interface ActionOrigin {
  reportId?: string;
}

/**
 * GEN-10: an admin lists open reports and resolves each one (dismiss, hide the content, delete it),
 * or hides or deletes any item directly. Content is reached only through its module's adapter (the
 * content-moderation port). Every change runs in one transaction with its GEN-07 audit entries, and
 * report status changes are conditional on OPEN, so two admins can never both resolve one report.
 * Hiding or deleting an item closes every open report on it (ACTIONED).
 */
@Injectable()
export class ModerationService {
  constructor(
    @InjectModel(Report.name) private readonly reports: Model<Report>,
    @InjectConnection() private readonly connection: Connection,
    private readonly registry: ContentRegistryService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  async listOpen(query: ListReportsQueryDto): Promise<Page<ReportDto>> {
    const page = await paginate(
      this.reports,
      {
        status: ReportStatus.Open,
        ...(query.targetType ? { targetType: query.targetType } : {}),
      },
      query.page,
      { sort: { createdAt: -1 } },
    );
    return { ...page, items: page.items.map(toReportDto) };
  }

  resolve(
    admin: AuthUser,
    reportId: string,
    action: ReportAction,
  ): Promise<ReportDto> {
    return this.connection.transaction(async (session) => {
      const report = await this.reports
        .findById(reportId)
        .session(session)
        .lean();
      if (!report) {
        throw new AppException(
          HttpStatus.NOT_FOUND,
          ErrorCode.NOT_FOUND,
          'Report not found',
        );
      }
      if (report.status !== ReportStatus.Open) {
        throw conflict('This report is already resolved');
      }
      const resolution = resolutionBy(admin, action);
      const updated = await this.reports
        .findOneAndUpdate(
          { _id: report._id, status: ReportStatus.Open },
          {
            $set: {
              status:
                action === ReportAction.Dismiss
                  ? ReportStatus.Dismissed
                  : ReportStatus.Actioned,
              resolution,
            },
          },
          { new: true, session },
        )
        .lean();
      if (!updated) {
        // Another admin resolved it between the read and the update.
        throw conflict('This report was resolved meanwhile; reload the list');
      }
      if (action !== ReportAction.Dismiss) {
        await this.actOnContent(
          admin,
          { type: report.targetType, id: report.targetId.toHexString() },
          action,
          resolution,
          session,
          { reportId },
        );
      }
      await this.audit.record(
        {
          actor: { id: admin.id, role: admin.role },
          action: AuditAction.ResolveReport,
          targetType: AuditTargetType.Report,
          targetId: reportId,
          metadata: { action },
        },
        session,
      );
      return toReportDto(updated);
    });
  }

  /** Hides or deletes an item directly (GEN-10), closing its open reports. */
  act(
    admin: AuthUser,
    target: ContentTarget,
    action: ContentAction,
  ): Promise<ModerationResultDto> {
    return this.connection.transaction(async (session) => {
      const resolvedReports = await this.actOnContent(
        admin,
        target,
        action,
        resolutionBy(admin, action),
        session,
        {},
      );
      return {
        contentType: target.type,
        contentId: target.id,
        action,
        resolvedReports,
      };
    });
  }

  /** Returns how many other open reports on the item became ACTIONED. */
  private async actOnContent(
    admin: AuthUser,
    target: ContentTarget,
    action: ContentAction,
    resolution: ReportResolution,
    session: ClientSession,
    origin: ActionOrigin,
  ): Promise<number> {
    const adapter = this.registry.adapterFor(target.type);
    const content = adapter ? await adapter.find(target.id, session) : null;
    if (!adapter || !content) {
      throw origin.reportId
        ? conflict(
            'The reported content no longer exists; dismiss the report instead',
          )
        : contentNotFound();
    }

    let changed = true;
    if (action === ReportAction.Hide) {
      if (content.hidden && !origin.reportId) {
        throw conflict('This content is already hidden');
      }
      // Through a report an already-hidden item (reported by its author) only closes the reports.
      changed = !content.hidden;
      if (changed) await adapter.setHidden(target.id, true, session);
    } else {
      await adapter.remove(target.id, session);
    }

    if (changed) {
      await this.audit.record(
        {
          actor: { id: admin.id, role: admin.role },
          action:
            action === ReportAction.Hide
              ? AuditAction.HideContent
              : AuditAction.DeleteContent,
          targetType: AUDIT_TARGET[target.type],
          targetId: target.id,
          metadata: {
            contentType: target.type,
            ownerId: content.ownerId,
            ...(origin.reportId ? { reportId: origin.reportId } : {}),
          },
        },
        session,
      );
    }

    const closed = await this.reports.updateMany(
      {
        targetType: target.type,
        targetId: new Types.ObjectId(target.id),
        status: ReportStatus.Open,
      },
      { $set: { status: ReportStatus.Actioned, resolution } },
      { session },
    );
    return closed.modifiedCount;
  }
}

function resolutionBy(admin: AuthUser, action: ReportAction): ReportResolution {
  return {
    action,
    adminId: new Types.ObjectId(admin.id),
    at: new Date(),
  };
}

function conflict(message: string): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_STATE_TRANSITION,
    message,
  );
}

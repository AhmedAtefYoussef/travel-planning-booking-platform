import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { assertOwner } from '../../common/auth/access';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  NotificationType,
  type NotificationInput,
  type NotificationsService,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { paginate, type Page } from '../../common/pagination/pagination';
import type {
  MarkAllReadDto,
  NotificationDto,
  UnreadCountDto,
} from './dto/notification.dto';
import {
  BODY_MAX,
  LINK_PATTERN,
  Notification,
  TITLE_MAX,
} from './schemas/notification.schema';

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const TYPES = new Set<string>(Object.values(NotificationType));
const NOT_FOUND_MESSAGE = 'Notification not found';

/**
 * GEN-01: NOTIFICATIONS_SERVICE implementation (other modules write) and the owner's inbox (list,
 * unread count, mark as read). A user only ever reads or changes their own notifications (ACC-11).
 */
@Injectable()
export class InAppNotificationsService implements NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly model: Model<Notification>,
  ) {}

  /** Writes in the caller's session, so the notification commits or aborts with their change. */
  async notify(
    input: NotificationInput,
    session?: ClientSession,
  ): Promise<void> {
    await this.notifyMany([input], session);
  }

  /** All or nothing: one invalid input (a programming defect) throws before anything is written. */
  async notifyMany(
    inputs: NotificationInput[],
    session?: ClientSession,
  ): Promise<void> {
    const docs = inputs.map(toDocument);
    if (!docs.length) return;
    await this.model.insertMany(docs, { session });
  }

  /** The caller's notifications, newest first, 10 per page (GEN-05). */
  async list(
    user: AuthUser,
    query: { page: number; unread?: boolean },
  ): Promise<Page<NotificationDto>> {
    const filter: FilterQuery<Notification> = { userId: ownerId(user) };
    if (query.unread === true) filter.readAt = null;
    if (query.unread === false) filter.readAt = { $ne: null };
    const page = await paginate(this.model, filter, query.page, {
      sort: { createdAt: -1 },
    });
    return { ...page, items: page.items.map(toDto) };
  }

  async unreadCount(user: AuthUser): Promise<UnreadCountDto> {
    const count = await this.model
      .countDocuments({ userId: ownerId(user), readAt: null })
      .exec();
    return { count };
  }

  /**
   * Idempotent: the first call stamps readAt, later calls return it unchanged. Another user's id gets
   * the very same 404 as an id that does not exist (ACC-11).
   */
  async markRead(
    user: AuthUser,
    id: string,
    now: Date = new Date(),
  ): Promise<NotificationDto> {
    const found = await this.model.findById(id).lean<LeanNotification>().exec();
    if (!found) throw notFound();
    assertOwner(user, found.userId, {
      notFound: true,
      notFoundMessage: NOT_FOUND_MESSAGE,
    });
    if (found.readAt) return toDto(found);
    const updated = await this.model
      .findOneAndUpdate(
        { _id: found._id, readAt: null },
        { $set: { readAt: now } },
        { new: true },
      )
      .lean<LeanNotification>()
      .exec();
    if (updated) return toDto(updated);
    // A concurrent call marked it first: return the readAt it stored.
    const current = await this.model
      .findById(id)
      .lean<LeanNotification>()
      .exec();
    return toDto(current ?? found);
  }

  async markAllRead(
    user: AuthUser,
    now: Date = new Date(),
  ): Promise<MarkAllReadDto> {
    const result = await this.model
      .updateMany(
        { userId: ownerId(user), readAt: null },
        { $set: { readAt: now } },
      )
      .exec();
    return { updated: result.modifiedCount };
  }
}

type LeanNotification = Notification & { _id: Types.ObjectId };

function ownerId(user: AuthUser): Types.ObjectId {
  return new Types.ObjectId(user.id);
}

function notFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    NOT_FOUND_MESSAGE,
  );
}

/** Validates a producer's input; a bad one is a bug in the calling module, so it throws a plain Error. */
function toDocument(input: NotificationInput) {
  const fail = (message: string): never => {
    throw new Error(`Invalid notification: ${message}`);
  };
  if (typeof input.userId !== 'string' || !OBJECT_ID.test(input.userId))
    fail('userId must be a 24-character hexadecimal id');
  if (!TYPES.has(input.type)) fail(`type ${String(input.type)} is unknown`);
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > TITLE_MAX)
    fail(`title must be 1 to ${TITLE_MAX} characters`);
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!body || body.length > BODY_MAX)
    fail(`body must be 1 to ${BODY_MAX} characters`);
  if (
    input.link !== undefined &&
    (typeof input.link !== 'string' || !LINK_PATTERN.test(input.link))
  )
    fail('link must be a frontend route starting with a single /');
  return {
    userId: new Types.ObjectId(input.userId),
    type: input.type,
    title,
    body,
    ...(input.link !== undefined ? { link: input.link } : {}),
    readAt: null,
  };
}

function toDto(n: LeanNotification): NotificationDto {
  return {
    id: n._id.toHexString(),
    type: n.type,
    title: n.title,
    body: n.body,
    ...(n.link ? { link: n.link } : {}),
    readAt: n.readAt ?? null,
    createdAt: n.createdAt,
  };
}

import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { SessionValidator } from '../../common/contracts';
import type { EnvironmentVariables } from '../../config/env.validation';
import { Session } from './schemas/session.schema';

export interface NewSession {
  sessionId: string;
  /** The raw refresh token: goes into the httpOnly cookie only, never into the database or a body. */
  refreshToken: string;
  expiresAt: Date;
}

export interface RotatedSession {
  sessionId: string;
  userId: string;
  /** The new raw refresh token; the presented one no longer works. */
  refreshToken: string;
  expiresAt: Date;
}

/** SHA-256 hex of a refresh token; the only form stored in `sessions` (TRVL-137). */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const newRefreshToken = () => randomBytes(32).toString('base64url');

/**
 * One session per login (ACC-04). A session is usable while it is not revoked, not past `expiresAt`
 * (JWT_REFRESH_TTL after login, never extended) and saw an authenticated request within
 * SESSION_IDLE_MINUTES (ACC-06). Every check-and-update is a single atomic MongoDB operation, so a
 * request racing a logout can never revive the session.
 */
@Injectable()
export class SessionsService implements SessionValidator {
  private readonly idleMs: number;

  constructor(
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.idleMs = config.get('SESSION_IDLE_MINUTES', { infer: true }) * 60_000;
  }

  /** 256 random bits: unguessable, so the token needs no signature of its own. */
  async create(
    userId: string,
    ttlMs: number,
    now = new Date(),
  ): Promise<NewSession> {
    const refreshToken = newRefreshToken();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const session = await this.sessions.create({
      userId: new Types.ObjectId(userId),
      refreshTokenHash: hashRefreshToken(refreshToken),
      lastActivityAt: now,
      expiresAt,
    });
    return { sessionId: session._id.toHexString(), refreshToken, expiresAt };
  }

  /** ACC-06: called by the global AuthGuard on every cookie-authenticated request. */
  async touch(
    sessionId: string,
    userId: string,
    now = new Date(),
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(sessionId) || !Types.ObjectId.isValid(userId)) {
      return false;
    }
    const res = await this.sessions.updateOne(
      {
        _id: new Types.ObjectId(sessionId),
        userId: new Types.ObjectId(userId),
        ...this.usableAt(now),
      },
      { $set: { lastActivityAt: now } },
    );
    return res.matchedCount === 1;
  }

  /**
   * ACC-06 refresh: swaps the presented refresh token for a new one in the same atomic update, so a
   * token can be used once; null when it is unknown, revoked, expired or idle.
   */
  async rotate(
    refreshToken: string,
    now = new Date(),
  ): Promise<RotatedSession | null> {
    const next = newRefreshToken();
    const session = await this.sessions.findOneAndUpdate(
      {
        refreshTokenHash: hashRefreshToken(refreshToken),
        ...this.usableAt(now),
      },
      {
        $set: { refreshTokenHash: hashRefreshToken(next), lastActivityAt: now },
      },
      { new: true },
    );
    if (!session) return null;
    return {
      sessionId: session._id.toHexString(),
      userId: session.userId.toHexString(),
      refreshToken: next,
      expiresAt: session.expiresAt,
    };
  }

  /** ACC-06 logout: ends the session found by its refresh token and/or id. Idempotent. */
  async revoke(
    by: { refreshToken?: string; sessionId?: string },
    now = new Date(),
  ): Promise<void> {
    const or: Record<string, unknown>[] = [];
    if (by.refreshToken) {
      or.push({ refreshTokenHash: hashRefreshToken(by.refreshToken) });
    }
    if (by.sessionId && Types.ObjectId.isValid(by.sessionId)) {
      or.push({ _id: new Types.ObjectId(by.sessionId) });
    }
    if (or.length === 0) return;
    await this.sessions.updateMany(
      { $or: or, revokedAt: { $exists: false } },
      { $set: { revokedAt: now } },
    );
  }

  /** Ends every session of a user (password change ACC-08, admin reset ACC-07a, suspension). */
  async revokeAllForUser(userId: string, now = new Date()): Promise<void> {
    await this.sessions.updateMany(
      { userId: new Types.ObjectId(userId), revokedAt: { $exists: false } },
      { $set: { revokedAt: now } },
    );
  }

  private usableAt(now: Date) {
    return {
      revokedAt: { $exists: false },
      expiresAt: { $gt: now },
      lastActivityAt: { $gte: new Date(now.getTime() - this.idleMs) },
    };
  }
}

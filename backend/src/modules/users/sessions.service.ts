import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { Session } from './schemas/session.schema';

export interface NewSession {
  sessionId: string;
  /** The raw refresh token: goes into the httpOnly cookie only, never into the database or a body. */
  refreshToken: string;
  expiresAt: Date;
}

/** SHA-256 hex of a refresh token; the only form stored in `sessions` (TRVL-137). */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** One session per login (ACC-04); revocation and idle expiry (ACC-06) build on it. */
@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
  ) {}

  /** 256 random bits: unguessable, so the token needs no signature of its own. */
  async create(
    userId: string,
    ttlMs: number,
    now = new Date(),
  ): Promise<NewSession> {
    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + ttlMs);
    const session = await this.sessions.create({
      userId: new Types.ObjectId(userId),
      refreshTokenHash: hashRefreshToken(refreshToken),
      lastActivityAt: now,
      expiresAt,
    });
    return { sessionId: session._id.toHexString(), refreshToken, expiresAt };
  }
}

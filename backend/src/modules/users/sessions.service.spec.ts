import type { ConfigService } from '@nestjs/config';
import { Types, type Model } from 'mongoose';
import type { Session } from './schemas/session.schema';
import {
  hashRefreshToken,
  ROTATION_GRACE_MS,
  SessionsService,
} from './sessions.service';

const NOW = new Date('2026-11-11T10:00:00Z');
const THIRTY_MIN_AGO = new Date('2026-11-11T09:30:00Z');
const USER = new Types.ObjectId();
const SESSION = new Types.ObjectId();

function setup() {
  const model = {
    create: jest
      .fn()
      .mockImplementation((doc: object) => ({ ...doc, _id: SESSION })),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    updateMany: jest.fn().mockResolvedValue({}),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn().mockResolvedValue({
      _id: SESSION,
      userId: USER,
      expiresAt: new Date('2026-11-18T10:00:00Z'),
    }),
  };
  const config = { get: () => 30 } as unknown as ConfigService<never, true>;
  return {
    service: new SessionsService(model as unknown as Model<Session>, config),
    model,
  };
}

/** The "still usable" part of every session filter (ACC-06). */
const usable = {
  revokedAt: { $exists: false },
  expiresAt: { $gt: NOW },
  lastActivityAt: { $gte: THIRTY_MIN_AGO },
};

describe('SessionsService.create (ACC-04)', () => {
  it('stores only the SHA-256 of a fresh random refresh token, with activity and expiry', async () => {
    const { service, model } = setup();
    const a = await service.create(USER.toHexString(), 60_000, NOW);
    const b = await service.create(USER.toHexString(), 60_000, NOW);

    const saved = model.create.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.refreshTokenHash).toBe(hashRefreshToken(a.refreshToken));
    expect(saved.refreshTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(saved).not.toHaveProperty('refreshToken');
    expect(saved.lastActivityAt).toEqual(NOW);
    expect(a.expiresAt).toEqual(new Date('2026-11-11T10:01:00Z'));
    expect(a.sessionId).toBe(SESSION.toHexString());
    // 32 random bytes in base64url, different every time.
    expect(a.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.refreshToken).not.toBe(b.refreshToken);
  });

  it('hashes deterministically', () => {
    expect(hashRefreshToken('abc')).toBe(hashRefreshToken('abc'));
    expect(hashRefreshToken('abc')).not.toBe(hashRefreshToken('abd'));
  });
});

describe('SessionsService.touch (ACC-06 idle expiry)', () => {
  it('accepts only an unrevoked, unexpired session active in the last 30 minutes, and records the request', async () => {
    const { service, model } = setup();
    await expect(
      service.touch(SESSION.toHexString(), USER.toHexString(), NOW),
    ).resolves.toBe(true);
    expect(model.updateOne).toHaveBeenCalledWith(
      { _id: SESSION, userId: USER, ...usable },
      { $set: { lastActivityAt: NOW } },
    );
  });

  it('reports false when no session matches (logged out, idle or expired)', async () => {
    const { service, model } = setup();
    model.updateOne.mockResolvedValue({ matchedCount: 0 });
    await expect(
      service.touch(SESSION.toHexString(), USER.toHexString(), NOW),
    ).resolves.toBe(false);
  });

  it('rejects malformed ids without a query', async () => {
    const { service, model } = setup();
    await expect(service.touch('x', USER.toHexString())).resolves.toBe(false);
    await expect(service.touch(SESSION.toHexString(), 'x')).resolves.toBe(
      false,
    );
    expect(model.updateOne).not.toHaveBeenCalled();
  });
});

describe('SessionsService.rotate (ACC-06 refresh)', () => {
  /** The previous-hash lookup used when the presented token is not the current one. */
  const previous = (found: unknown) => ({
    select: () => ({ lean: () => Promise.resolve(found) }),
  });

  it('swaps the presented token for a new one and remembers the old hash, in one atomic update', async () => {
    const { service, model } = setup();
    const result = await service.rotate('old-token', NOW);
    if (result.kind !== 'rotated') throw new Error('expected a rotation');

    const [filter, update] = model.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    expect(filter).toEqual({
      refreshTokenHash: hashRefreshToken('old-token'),
      ...usable,
    });
    expect(update.$set).toEqual({
      refreshTokenHash: hashRefreshToken(result.refreshToken),
      previousRefreshTokenHash: hashRefreshToken('old-token'),
      rotatedAt: NOW,
      lastActivityAt: NOW,
    });
    expect(result).toMatchObject({
      sessionId: SESSION.toHexString(),
      userId: USER.toHexString(),
    });
    expect(result.refreshToken).not.toBe('old-token');
  });

  it('is invalid for an unknown token, or one whose session is already revoked', async () => {
    const { service, model } = setup();
    model.findOneAndUpdate.mockResolvedValue(null);
    model.findOne.mockReturnValue(previous(null));
    await expect(service.rotate('old-token', NOW)).resolves.toEqual({
      kind: 'invalid',
    });

    model.findOne.mockReturnValue(previous({ _id: SESSION, revokedAt: NOW }));
    await expect(service.rotate('old-token', NOW)).resolves.toEqual({
      kind: 'invalid',
    });
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('treats the just-rotated token within the grace window as a parallel tab, without ending the session', async () => {
    const { service, model } = setup();
    model.findOneAndUpdate.mockResolvedValue(null);
    model.findOne.mockReturnValue(
      previous({
        _id: SESSION,
        rotatedAt: new Date(NOW.getTime() - ROTATION_GRACE_MS),
      }),
    );
    await expect(service.rotate('old-token', NOW)).resolves.toEqual({
      kind: 'superseded',
    });
    expect(model.findOne).toHaveBeenCalledWith({
      previousRefreshTokenHash: hashRefreshToken('old-token'),
    });
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('ends the whole session when an already-rotated token comes back later (reuse)', async () => {
    const { service, model } = setup();
    model.findOneAndUpdate.mockResolvedValue(null);
    model.findOne.mockReturnValue(
      previous({
        _id: SESSION,
        rotatedAt: new Date(NOW.getTime() - ROTATION_GRACE_MS - 1),
      }),
    );
    await expect(service.rotate('old-token', NOW)).resolves.toEqual({
      kind: 'reused',
    });
    expect(model.updateOne).toHaveBeenCalledWith(
      { _id: SESSION, revokedAt: { $exists: false } },
      { $set: { revokedAt: NOW } },
    );
  });
});

describe('SessionsService.revoke (ACC-06 logout)', () => {
  it('revokes by refresh token and session id in one update', async () => {
    const { service, model } = setup();
    await service.revoke(
      { refreshToken: 'tok', sessionId: SESSION.toHexString() },
      NOW,
    );
    expect(model.updateMany).toHaveBeenCalledWith(
      {
        $or: [{ refreshTokenHash: hashRefreshToken('tok') }, { _id: SESSION }],
        revokedAt: { $exists: false },
      },
      { $set: { revokedAt: NOW } },
    );
  });

  it('does nothing without a usable identifier', async () => {
    const { service, model } = setup();
    await service.revoke({});
    await service.revoke({ sessionId: 'not-an-id' });
    expect(model.updateMany).not.toHaveBeenCalled();
  });

  it('revokes every open session of a user', async () => {
    const { service, model } = setup();
    await service.revokeAllForUser(USER.toHexString(), NOW);
    expect(model.updateMany).toHaveBeenCalledWith(
      { userId: USER, revokedAt: { $exists: false } },
      { $set: { revokedAt: NOW } },
    );
  });
});

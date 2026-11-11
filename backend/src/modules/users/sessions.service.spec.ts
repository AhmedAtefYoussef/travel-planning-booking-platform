import { Types, type Model } from 'mongoose';
import type { Session } from './schemas/session.schema';
import { hashRefreshToken, SessionsService } from './sessions.service';

describe('SessionsService.create (ACC-04)', () => {
  it('stores only the SHA-256 of a fresh random refresh token, with activity and expiry', async () => {
    const id = new Types.ObjectId();
    const create = jest
      .fn()
      .mockImplementation((doc: object) => ({ ...doc, _id: id }));
    const service = new SessionsService({
      create,
    } as unknown as Model<Session>);
    const now = new Date('2026-11-11T10:00:00Z');

    const a = await service.create(id.toHexString(), 60_000, now);
    const b = await service.create(id.toHexString(), 60_000, now);

    const saved = create.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.refreshTokenHash).toBe(hashRefreshToken(a.refreshToken));
    expect(saved.refreshTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(saved).not.toHaveProperty('refreshToken');
    expect(saved.lastActivityAt).toEqual(now);
    expect(a.expiresAt).toEqual(new Date('2026-11-11T10:01:00Z'));
    expect(a.sessionId).toBe(id.toHexString());
    // 32 random bytes in base64url, different every time.
    expect(a.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.refreshToken).not.toBe(b.refreshToken);
  });

  it('hashes deterministically', () => {
    expect(hashRefreshToken('abc')).toBe(hashRefreshToken('abc'));
    expect(hashRefreshToken('abc')).not.toBe(hashRefreshToken('abd'));
  });
});

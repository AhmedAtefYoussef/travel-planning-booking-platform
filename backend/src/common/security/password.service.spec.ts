import { AppException } from '../errors/app.exception';
import { BCRYPT_ROUNDS, PasswordService } from './password.service';

/** Low work factor keeps the suite fast; production uses BCRYPT_ROUNDS (12). */
class FastPasswordService extends PasswordService {
  protected readonly rounds = 4;
}

describe('PasswordService (GEN-13: salted hashes only)', () => {
  const service = new FastPasswordService();

  it('stores a salted bcrypt hash, never the plain text', async () => {
    const hash = await service.hash('Sup3r$ecret!');
    expect(hash).not.toContain('Sup3r$ecret!');
    expect(hash).toMatch(/^\$2[aby]\$04\$.{53}$/);
  });

  it('uses a fresh salt per hash', async () => {
    const [a, b] = await Promise.all([
      service.hash('same-password'),
      service.hash('same-password'),
    ]);
    expect(a).not.toBe(b);
    expect(await service.verify('same-password', a)).toBe(true);
    expect(await service.verify('same-password', b)).toBe(true);
  });

  it('verifies correctly and never throws on bad input', async () => {
    const hash = await service.hash('Correct#Horse1');
    expect(await service.verify('Correct#Horse1', hash)).toBe(true);
    expect(await service.verify('correct#horse1', hash)).toBe(false);
    expect(await service.verify('Correct#Horse1', 'not-a-hash')).toBe(false);
    expect(await service.verify('Correct#Horse1', null)).toBe(false);
    expect(await service.verify('x'.repeat(100), hash)).toBe(false);
  });

  it('rejects empty and over-long passwords instead of truncating them', async () => {
    await expect(service.hash('')).rejects.toBeInstanceOf(AppException);
    // 73 bytes: bcrypt would silently ignore the last byte.
    await expect(service.hash('a'.repeat(73))).rejects.toThrow(/too long/);
    // Multi-byte characters count as bytes: 25 x 3-byte chars = 75 bytes.
    await expect(service.hash('€'.repeat(25))).rejects.toThrow(/too long/);
    await expect(service.hash('a'.repeat(72))).resolves.toMatch(/^\$2/);
  });

  it('flags hashes made with a weaker work factor', async () => {
    const weak = await service.hash('pw-for-rehash');
    expect(new PasswordService().needsRehash(weak)).toBe(true);
    expect(service.needsRehash(weak)).toBe(false);
    expect(service.needsRehash('garbage')).toBe(true);
    expect(BCRYPT_ROUNDS).toBeGreaterThanOrEqual(12);
  });
});

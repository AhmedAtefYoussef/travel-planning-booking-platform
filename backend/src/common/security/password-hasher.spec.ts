import { PasswordHasher } from './password-hasher';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('hashes to something other than the plain text', async () => {
    const hash = await hasher.hash('S3cret-pass');
    expect(hash).not.toBe('S3cret-pass');
    expect(hash).toMatch(/^\$2[aby]\$/);
  });

  it('salts: same input hashes differently', async () => {
    const a = await hasher.hash('S3cret-pass');
    const b = await hasher.hash('S3cret-pass');
    expect(a).not.toBe(b);
  });

  it('verifies correct and rejects wrong passwords', async () => {
    const hash = await hasher.hash('S3cret-pass');
    await expect(hasher.verify('S3cret-pass', hash)).resolves.toBe(true);
    await expect(hasher.verify('wrong', hash)).resolves.toBe(false);
  });

  it('returns false for a malformed hash', async () => {
    await expect(hasher.verify('x', 'not-a-hash')).resolves.toBe(false);
  });
});

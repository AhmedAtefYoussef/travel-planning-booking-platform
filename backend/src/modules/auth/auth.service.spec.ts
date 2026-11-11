import type { PasswordService } from '../../common/security/password.service';
import type { UsersService } from '../users';
import { AuthService } from './auth.service';

describe('AuthService.register (ACC-01)', () => {
  it('stores only the password hash and records when the terms were accepted', async () => {
    const users = { createTraveller: jest.fn().mockResolvedValue({ id: 'x' }) };
    const passwords = { hash: jest.fn().mockResolvedValue('bcrypt-hash') };
    const service = new AuthService(
      users as unknown as UsersService,
      passwords as unknown as PasswordService,
    );

    const before = Date.now();
    await expect(
      service.register({
        name: 'Mona Hassan',
        email: 'mona@example.com',
        password: 'Travel2026',
        acceptTerms: true,
      }),
    ).resolves.toEqual({ id: 'x' });

    expect(passwords.hash).toHaveBeenCalledWith('Travel2026');
    const saved = users.createTraveller.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(saved).toEqual({
      name: 'Mona Hassan',
      email: 'mona@example.com',
      passwordHash: 'bcrypt-hash',
      termsAcceptedAt: expect.any(Date),
    });
    expect((saved.termsAcceptedAt as Date).getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(saved).not.toHaveProperty('password');
  });
});

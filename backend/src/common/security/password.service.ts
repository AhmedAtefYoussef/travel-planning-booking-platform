import { HttpStatus, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

/** bcrypt work factor: ~250 ms per hash on a laptop, a deliberate cost for brute-force attacks. */
export const BCRYPT_ROUNDS = 12;
/** bcrypt silently ignores input beyond 72 bytes, so longer passwords are rejected instead. */
export const MAX_PASSWORD_BYTES = 72;

/**
 * Passwords are stored only as salted bcrypt hashes (GEN-13). bcrypt generates a random salt per
 * hash and embeds it, so two users with the same password get different hashes.
 * Password *rules* (length, character classes) belong to ACC-01/ACC-08 DTO validation.
 */
@Injectable()
export class PasswordService {
  /** Overridable in tests only (low rounds keep unit tests fast). */
  protected readonly rounds: number = BCRYPT_ROUNDS;

  async hash(plain: string): Promise<string> {
    this.assertHashable(plain);
    return bcrypt.hash(plain, this.rounds);
  }

  /** Constant-time comparison; false (never an exception) for a wrong password or a malformed hash. */
  async verify(
    plain: string,
    hash: string | null | undefined,
  ): Promise<boolean> {
    if (
      !hash ||
      typeof plain !== 'string' ||
      Buffer.byteLength(plain, 'utf8') > MAX_PASSWORD_BYTES
    ) {
      return false;
    }
    try {
      return await bcrypt.compare(plain, hash);
    } catch {
      return false;
    }
  }

  /** True when a stored hash used a lower work factor and should be re-hashed after login. */
  needsRehash(hash: string): boolean {
    try {
      return bcrypt.getRounds(hash) < this.rounds;
    } catch {
      return true;
    }
  }

  private assertHashable(plain: string): void {
    if (typeof plain !== 'string' || plain.length === 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Password is required',
        [{ field: 'password', message: 'password is required' }],
      );
    }
    if (Buffer.byteLength(plain, 'utf8') > MAX_PASSWORD_BYTES) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Password is too long',
        [
          {
            field: 'password',
            message: `password must be at most ${MAX_PASSWORD_BYTES} bytes`,
          },
        ],
      );
    }
  }
}

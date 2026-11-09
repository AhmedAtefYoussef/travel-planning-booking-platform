import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

@Injectable()
export class PasswordHasher {
  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, SALT_ROUNDS);
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(plain, hash);
    } catch {
      return false;
    }
  }
}

const defaultHasher = new PasswordHasher();

/** Functional API (api.md contract): salted bcrypt hash. */
export const hash = (plain: string): Promise<string> =>
  defaultHasher.hash(plain);

/** Functional API (api.md contract): true when plain matches the hash. */
export const verify = (plain: string, hashed: string): Promise<boolean> =>
  defaultHasher.verify(plain, hashed);

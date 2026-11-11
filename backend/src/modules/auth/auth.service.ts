import { Injectable } from '@nestjs/common';
import { PasswordService } from '../../common/security/password.service';
import { UserProfileDto, UsersService } from '../users';
import type { RegisterDto } from './dto/register.dto';

/** Registration now; login, cookies, refresh and logout (ACC-04, ACC-06, ACC-19) build on it. */
@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
  ) {}

  /** ACC-01: the DTO has already checked the rules and the consent; the password is stored hashed only. */
  async register(dto: RegisterDto): Promise<UserProfileDto> {
    return this.users.createTraveller({
      name: dto.name,
      email: dto.email,
      passwordHash: await this.passwords.hash(dto.password),
      termsAcceptedAt: new Date(),
    });
  }
}

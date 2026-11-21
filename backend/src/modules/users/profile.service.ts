import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  REFERENCE_SERVICE,
  type ReferenceService,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { toUserProfile, type UserProfileDto } from './dto/user-profile.dto';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import { User } from './schemas/user.schema';

/** /api/users/me (ACC-09, ACC-11): an account reads and edits only its own profile. */
@Injectable()
export class ProfileService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @Inject(REFERENCE_SERVICE) private readonly reference: ReferenceService,
  ) {}

  async get(caller: AuthUser): Promise<UserProfileDto> {
    const user = Types.ObjectId.isValid(caller.id)
      ? await this.users.findById(caller.id)
      : null;
    if (!user) throw accountGone();
    return toUserProfile(user);
  }

  /**
   * ACC-09: saves only when every sent field is valid. The DTO checked the formats; here the currency
   * is checked against the supported codes of Countries.csv (brief 5.1). One update writes them all.
   */
  async update(
    caller: AuthUser,
    dto: UpdateProfileDto,
  ): Promise<UserProfileDto> {
    const changes = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    ) as Partial<Pick<User, 'name' | 'phone' | 'preferredCurrency'>>;
    if (Object.keys(changes).length === 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'Send at least one of name, phone or preferredCurrency',
      );
    }
    if (changes.preferredCurrency) {
      const supported = await this.supportedCurrencies();
      if (!supported.has(changes.preferredCurrency)) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          'Validation failed',
          [
            {
              field: 'preferredCurrency',
              message: `preferredCurrency must be one of ${[...supported].sort().join(', ')}`,
            },
          ],
        );
      }
    }

    const user = Types.ObjectId.isValid(caller.id)
      ? await this.users.findByIdAndUpdate(
          caller.id,
          { $set: changes },
          { new: true, runValidators: true },
        )
      : null;
    if (!user) throw accountGone();
    return toUserProfile(user);
  }

  private async supportedCurrencies(): Promise<Set<string>> {
    const countries = await this.reference.listCountries();
    return new Set(countries.map((c) => c.currency.toUpperCase()));
  }
}

function accountGone(): AppException {
  return new AppException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.UNAUTHENTICATED,
    'This account no longer exists; please log in again',
  );
}

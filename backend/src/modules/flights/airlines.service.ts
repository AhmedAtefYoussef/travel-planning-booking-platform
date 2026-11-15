import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { assertProviderScope } from '../../common/auth/access';
import { AuthUser, ProviderType } from '../../common/auth/auth.types';
import {
  cancellationTierFieldErrors,
  selectCancellationTier,
} from '../../common/contracts';
import { UPLOADS_SERVICE } from '../../common/contracts/tokens';
import type {
  UploadedFileLike,
  UploadsService,
} from '../../common/contracts/services.contract';
import {
  AppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type {
  AirlineDto,
  BaggagePolicyDto,
  CancellationPolicyDto,
  CreateAirlineDto,
  RefundPreviewDto,
  UpdateAirlineDto,
} from './dto/airline.dto';
import { localUploadUrlPattern } from '../../common/validation';
import { Airline, AirlineDocument } from './schemas/airline.schema';

/** A logo file this backend stored (GEN-08); other logos are external links. */
const AIRLINE_UPLOAD_URL = localUploadUrlPattern(['airlines']);

/**
 * Airline profiles (FLT-01). Rules live here, not in the controller, so they hold for every caller
 * (GEN-13): only the moderator assigned to an airline may edit it (ACC-11, brief section 4), and a
 * duplicate code becomes 409 DUPLICATE_KEY through the unique index and the global error filter.
 */
@Injectable()
export class AirlinesService {
  constructor(
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @Inject(UPLOADS_SERVICE) private readonly uploads: UploadsService,
  ) {}

  async create(dto: CreateAirlineDto): Promise<AirlineDto> {
    const airline = await this.airlines.create({
      name: dto.name,
      code: dto.code,
      logoUrl: dto.logoUrl ?? null,
    });
    return toAirlineDto(airline);
  }

  async findById(id: string): Promise<AirlineDto> {
    return toAirlineDto(await this.load(id));
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateAirlineDto,
  ): Promise<AirlineDto> {
    const airline = await this.load(id);
    assertProviderScope(user, ProviderType.Airline, airline._id);
    if (
      dto.name === undefined &&
      dto.code === undefined &&
      dto.logoUrl === undefined
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'Send at least one of name, code or logoUrl',
      );
    }
    if (dto.name !== undefined) airline.name = dto.name;
    if (dto.code !== undefined) airline.code = dto.code;
    if (dto.logoUrl !== undefined) airline.logoUrl = dto.logoUrl;
    await airline.save();
    return toAirlineDto(airline);
  }

  /**
   * GEN-08 / FLT-01: replaces the airline's logo with one uploaded JPG/PNG (one logo per airline). The
   * new file is stored first and swapped in with one atomic update that returns the previous value, so
   * even two concurrent replacements each delete exactly the logo they replaced. The previous file is
   * deleted only when it was an upload that no other airline uses; an http(s) logo is left alone.
   */
  async setLogo(
    user: AuthUser,
    id: string,
    files: UploadedFileLike[],
  ): Promise<AirlineDto> {
    const airline = await this.load(id);
    assertProviderScope(user, ProviderType.Airline, airline._id, {
      allowAdmin: true,
    });
    const [logo] = await this.uploads.saveImages(files, {
      entityType: 'AIRLINE_LOGO',
      entityId: id,
      // Replacing: the current logo is removed below, so it does not count towards the limit of one.
      existingCount: 0,
    });
    let previous: AirlineDocument | null;
    try {
      previous = await this.airlines
        .findOneAndUpdate(
          { _id: id },
          { $set: { logoUrl: logo.url } },
          { new: false },
        )
        .exec();
    } catch (err) {
      await this.uploads.deleteImage(logo.url);
      throw err;
    }
    if (!previous) {
      await this.uploads.deleteImage(logo.url);
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Airline not found',
      );
    }
    const old = previous.logoUrl;
    if (old && old !== logo.url && AIRLINE_UPLOAD_URL.test(old)) {
      const stillUsed = await this.airlines.exists({ logoUrl: old }).exec();
      if (!stillUsed) await this.uploads.deleteImage(old);
    }
    return this.findById(id);
  }

  /** FLT-08: set (or replace) the extra-baggage policy; only the airline's moderator. */
  async setBaggagePolicy(
    user: AuthUser,
    id: string,
    dto: BaggagePolicyDto,
  ): Promise<AirlineDto> {
    const airline = await this.load(id);
    assertProviderScope(user, ProviderType.Airline, airline._id);
    airline.set('policy.extraBaggage', {
      pricePerBagMinor: dto.pricePerBagMinor,
      maxExtraBagsPerPassenger: dto.maxExtraBagsPerPassenger,
    });
    await airline.save();
    return toAirlineDto(airline);
  }

  /**
   * FLT-09: replaces the airline's cancellation tiers. Each threshold must be unique (checked with
   * the shared cancellationTierFieldErrors, like hotel policies); tiers are
   * stored sorted by threshold so they read naturally. Existing bookings keep the policy they
   * accepted (PAY-02 snapshot), so this only affects future bookings.
   */
  async setCancellationPolicy(
    user: AuthUser,
    id: string,
    dto: CancellationPolicyDto,
  ): Promise<AirlineDto> {
    const airline = await this.load(id);
    assertProviderScope(user, ProviderType.Airline, airline._id);
    // Shared with hotel policies (HTL-10): unique integer thresholds >= 0, refunds 0..100 %.
    const errors = cancellationTierFieldErrors(dto.tiers);
    if (errors.length) throw new ValidationFailedException(errors);
    const tiers = [...dto.tiers]
      .sort((a, b) => a.daysBefore - b.daysBefore)
      .map((t) => ({
        daysBefore: t.daysBefore,
        refundPercent: t.refundPercent,
      }));
    airline.set('policy.cancellationTiers', tiers);
    await airline.save();
    return toAirlineDto(airline);
  }

  /**
   * FLT-09 selection rule: the tier with the highest threshold not exceeding the days remaining;
   * none applies means 0%. Uses the shared selectCancellationTier that refunds (PAY-03) also use.
   */
  async previewRefund(
    id: string,
    daysRemaining: number,
  ): Promise<RefundPreviewDto> {
    const airline = await this.load(id);
    const tier = selectCancellationTier(
      airline.policy?.cancellationTiers ?? [],
      daysRemaining,
    );
    return {
      daysRemaining,
      tierApplied: tier
        ? { daysBefore: tier.daysBefore, refundPercent: tier.refundPercent }
        : null,
      refundPercent: tier?.refundPercent ?? 0,
    };
  }

  /** Loads an airline or throws 404; other services reuse it (flights, policies). */
  async load(id: string | Types.ObjectId): Promise<AirlineDocument> {
    const airline = await this.airlines.findById(id).exec();
    if (!airline) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Airline not found',
      );
    }
    return airline;
  }

  /**
   * Loads an airline that may still manage flights: 404 if it doesn't exist, 403 if an admin has
   * deactivated it (ACC-15). Its existing data stays readable; it just can't add or change flights.
   */
  async loadActive(id: string | Types.ObjectId): Promise<AirlineDocument> {
    const airline = await this.load(id);
    if (!airline.isActive) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'This airline is deactivated (ACC-15), so its flights cannot be created or changed',
      );
    }
    return airline;
  }
}

export function toAirlineDto(airline: AirlineDocument): AirlineDto {
  const extra = airline.policy?.extraBaggage;
  return {
    id: airline.id as string,
    name: airline.name,
    code: airline.code,
    logoUrl: airline.logoUrl ?? null,
    isActive: airline.isActive,
    policy: {
      cancellationTiers: (airline.policy?.cancellationTiers ?? []).map((t) => ({
        daysBefore: t.daysBefore,
        refundPercent: t.refundPercent,
      })),
      extraBaggage: extra
        ? {
            pricePerBagMinor: extra.pricePerBagMinor,
            maxExtraBagsPerPassenger: extra.maxExtraBagsPerPassenger,
          }
        : null,
    },
    createdAt: airline.createdAt,
    updatedAt: airline.updatedAt,
  };
}

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { assertProviderScope } from '../../common/auth/access';
import { AuthUser, ProviderType } from '../../common/auth/auth.types';
import {
  cancellationTierFieldErrors,
  selectCancellationTier,
  UPLOADS_SERVICE,
  type UploadedFileLike,
  type UploadsService,
} from '../../common/contracts';
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
import { Airline, AirlineDocument } from './schemas/airline.schema';

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
    const previousLogo = airline.logoUrl;
    if (dto.name !== undefined) airline.name = dto.name;
    if (dto.code !== undefined) airline.code = dto.code;
    if (dto.logoUrl !== undefined) airline.logoUrl = dto.logoUrl;
    await airline.save();
    // A logo replaced by a link or removed leaves no orphan file behind (GEN-08).
    if (previousLogo && previousLogo !== airline.logoUrl) {
      await this.uploads.deleteImage(previousLogo);
    }
    return toAirlineDto(airline);
  }

  /**
   * FLT-01 + GEN-08: the airline's moderator uploads the logo as a JPG or PNG of at most 5 MB. An
   * airline has exactly one logo, so a new upload replaces the previous one and its file is removed.
   */
  async setLogo(
    user: AuthUser,
    id: string,
    file: UploadedFileLike | undefined,
  ): Promise<AirlineDto> {
    const airline = await this.load(id);
    assertProviderScope(user, ProviderType.Airline, airline._id);
    if (!file) {
      throw new ValidationFailedException([
        {
          field: 'file',
          message: 'Attach the logo as a JPG or PNG image in the "file" field',
        },
      ]);
    }
    const [stored] = await this.uploads.saveImages([file], {
      entityType: 'AIRLINE_LOGO',
      entityId: airline.id as string,
      // PUT replaces: the previous logo does not count against the limit of one.
      existingCount: 0,
    });
    const previousLogo = airline.logoUrl;
    let updated: AirlineDocument;
    try {
      updated = await this.swapLogo(airline, stored.url);
    } catch (e) {
      await this.uploads.deleteImage(stored.url);
      throw e;
    }
    if (previousLogo) await this.uploads.deleteImage(previousLogo);
    return toAirlineDto(updated);
  }

  /**
   * Replaces the logo only if it is still the one this request read. Two uploads at the same moment
   * would otherwise both delete the old file and leave one new file that nothing points to; here the
   * second one gets a 409 and its file is removed by the caller.
   */
  private async swapLogo(
    airline: AirlineDocument,
    next: string | null,
  ): Promise<AirlineDocument> {
    const updated = await this.airlines
      .findOneAndUpdate(
        { _id: airline._id, logoUrl: airline.logoUrl },
        { $set: { logoUrl: next } },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        'The logo was changed by another request at the same time. Please try again.',
      );
    }
    return updated;
  }

  /** FLT-01 + GEN-08: removes the logo and its stored file. Removing a missing logo is a no-op. */
  async removeLogo(user: AuthUser, id: string): Promise<AirlineDto> {
    const airline = await this.load(id);
    assertProviderScope(user, ProviderType.Airline, airline._id);
    const previousLogo = airline.logoUrl;
    if (!previousLogo) return toAirlineDto(airline);
    const updated = await this.swapLogo(airline, null);
    await this.uploads.deleteImage(previousLogo);
    return toAirlineDto(updated);
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

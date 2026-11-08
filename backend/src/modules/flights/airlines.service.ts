import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { assertProviderScope } from '../../common/auth/access';
import { AuthUser, ProviderType } from '../../common/auth/auth.types';
import { selectCancellationTier } from '../../common/contracts';
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
   * FLT-09: replaces the airline's cancellation tiers. Each threshold must be unique; tiers are
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
    const firstIndex = new Map<number, number>();
    const duplicates = dto.tiers.flatMap((tier, i) => {
      const first = firstIndex.get(tier.daysBefore);
      if (first === undefined) {
        firstIndex.set(tier.daysBefore, i);
        return [];
      }
      return [
        {
          field: `tiers[${i}].daysBefore`,
          message: `daysBefore ${tier.daysBefore} is already used by tiers[${first}]; thresholds must be unique`,
        },
      ];
    });
    if (duplicates.length) throw new ValidationFailedException(duplicates);
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

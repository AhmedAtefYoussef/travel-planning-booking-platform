import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { assertProviderScope } from '../../common/auth/access';
import { AuthUser, ProviderType } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type {
  AirlineDto,
  CreateAirlineDto,
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

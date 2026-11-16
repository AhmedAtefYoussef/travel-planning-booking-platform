import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { isOwner } from '../../common/auth/access';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  CURRENCY_SERVICE,
  REFERENCE_SERVICE,
} from '../../common/contracts/tokens';
import type {
  CurrencyService,
  ReferenceService,
} from '../../common/contracts/services.contract';
import {
  AppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { Itinerary, ItineraryVisibility } from '../itineraries';
import type {
  CreateTransportCostDto,
  TransportCostDto,
  UpdateTransportCostDto,
} from './dto/budget.dto';
import { TransportCost } from './schemas/transport-cost.schema';

interface DayLike {
  _id: Types.ObjectId;
  order: number;
  cityId: string;
}
interface ItineraryLike {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  startDate: string;
  visibility: ItineraryVisibility;
  isHidden?: boolean;
  days: DayLike[];
}
type TransportLike = TransportCost & { _id: Types.ObjectId };

const ITINERARY_NOT_FOUND = 'Itinerary not found';

/**
 * Intercity transport costs (ITN-16). Only the itinerary's owner adds, edits or deletes them (ACC-11); a
 * private itinerary answers 404 to anyone else, exactly like an unknown id. Amounts are stored in the
 * currency the user chose (a seeded currency), between two different reference cities.
 */
@Injectable()
export class BudgetsService {
  constructor(
    @InjectModel(TransportCost.name)
    private readonly transports: Model<TransportCost>,
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    @Inject(CURRENCY_SERVICE) private readonly currency: CurrencyService,
    @Inject(REFERENCE_SERVICE) private readonly reference: ReferenceService,
  ) {}

  async addTransport(
    user: AuthUser,
    itineraryId: string,
    dto: CreateTransportCostDto,
  ): Promise<TransportCostDto> {
    const itinerary = await this.loadOwned(user, itineraryId);
    this.assertDay(itinerary, dto.dayId, 'dayId');
    await this.assertRoute(dto.fromCityId, dto.toCityId);
    await this.assertCurrency(dto.currency);
    const cost = await this.transports.create({
      itineraryId: itinerary._id,
      dayId: new Types.ObjectId(dto.dayId),
      mode: dto.mode,
      fromCityId: dto.fromCityId,
      toCityId: dto.toCityId,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
    });
    return toTransportDto(cost);
  }

  async updateTransport(
    user: AuthUser,
    id: string,
    dto: UpdateTransportCostDto,
  ): Promise<TransportCostDto> {
    const cost = await this.transports
      .findById(id)
      .lean<TransportLike>()
      .exec();
    if (!cost) throw notFound('Transport cost not found');
    const itinerary = await this.loadOwned(
      user,
      cost.itineraryId.toHexString(),
      'Transport cost not found',
    );
    if (dto.dayId !== undefined) this.assertDay(itinerary, dto.dayId, 'dayId');
    if (dto.fromCityId !== undefined || dto.toCityId !== undefined) {
      await this.assertRoute(
        dto.fromCityId ?? cost.fromCityId,
        dto.toCityId ?? cost.toCityId,
      );
    }
    if (dto.currency !== undefined) await this.assertCurrency(dto.currency);
    const set: Record<string, unknown> = { ...dto };
    if (dto.dayId !== undefined) set.dayId = new Types.ObjectId(dto.dayId);
    const updated = await this.transports
      .findOneAndUpdate(
        { _id: cost._id },
        { $set: set },
        { new: true, runValidators: true },
      )
      .lean<TransportLike>()
      .exec();
    if (!updated) throw notFound('Transport cost not found');
    return toTransportDto(updated);
  }

  async removeTransport(user: AuthUser, id: string): Promise<void> {
    const cost = await this.transports
      .findById(id)
      .lean<TransportLike>()
      .exec();
    if (!cost) throw notFound('Transport cost not found');
    await this.loadOwned(
      user,
      cost.itineraryId.toHexString(),
      'Transport cost not found',
    );
    await this.transports.deleteOne({ _id: cost._id }).exec();
  }

  /** The caller's own itinerary; anyone else gets 404, like an unknown id (ACC-11). */
  private async loadOwned(
    user: AuthUser,
    itineraryId: string,
    notFoundMessage = ITINERARY_NOT_FOUND,
  ): Promise<ItineraryLike> {
    const itinerary = await this.itineraries
      .findById(itineraryId)
      .lean<ItineraryLike>()
      .exec();
    if (!itinerary || !isOwner(user, itinerary.ownerId)) {
      throw notFound(notFoundMessage);
    }
    return itinerary;
  }

  /** The day must belong to this itinerary: 404 when it is the path, 400 when it is in the body. */
  private assertDay(
    itinerary: ItineraryLike,
    dayId: string,
    field: string,
    inPath = false,
  ): void {
    if (itinerary.days.some((d) => d._id.toHexString() === dayId)) return;
    if (inPath) throw notFound('Day not found in this itinerary');
    throw new ValidationFailedException([
      { field, message: `${field} must be a day of this itinerary` },
    ]);
  }

  private async assertRoute(from: string, to: string): Promise<void> {
    const errors: { field: string; message: string }[] = [];
    const [fromCity, toCity] = await Promise.all([
      this.reference.getCity(from),
      this.reference.getCity(to),
    ]);
    if (!fromCity) {
      errors.push({ field: 'fromCityId', message: `Unknown city '${from}'` });
    }
    if (!toCity) {
      errors.push({ field: 'toCityId', message: `Unknown city '${to}'` });
    }
    if (from === to) {
      errors.push({
        field: 'toCityId',
        message: 'toCityId must differ from fromCityId',
      });
    }
    if (errors.length) throw new ValidationFailedException(errors);
  }

  private async assertCurrency(code: string): Promise<void> {
    const supported = await this.currency.supportedCurrencies();
    if (!supported.includes(code)) {
      throw new ValidationFailedException([
        {
          field: 'currency',
          message: `currency must be a supported currency (GET /api/currencies); '${code}' is not`,
        },
      ]);
    }
  }
}

function notFound(message: string): AppException {
  return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, message);
}

function toTransportDto(t: TransportLike): TransportCostDto {
  return {
    id: t._id.toHexString(),
    itineraryId: t.itineraryId.toHexString(),
    dayId: t.dayId.toHexString(),
    mode: t.mode,
    fromCityId: t.fromCityId,
    toCityId: t.toCityId,
    amountMinor: t.amountMinor,
    currency: t.currency,
  };
}

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import type { EnvironmentVariables } from '../../config/env.validation';
import {
  Activity,
  Itinerary,
  itineraryDayDate,
  ItineraryVisibility,
} from '../itineraries';
import {
  emptyByCategory,
  groupBudgetItems,
  INTERCITY_TRANSPORT,
  type BudgetItem,
} from './budget-rules';
import type {
  BudgetEntryDto,
  BudgetSummaryDto,
  CreateBudgetEntryDto,
  CreateTransportCostDto,
  DayTotalDto,
  TransportCostDto,
  UpdateBudgetEntryDto,
  UpdateTransportCostDto,
} from './dto/budget.dto';
import { BudgetCategory, BudgetEntry } from './schemas/budget-entry.schema';
import { TransportCost, TransportMode } from './schemas/transport-cost.schema';

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
type EntryLike = BudgetEntry & { _id: Types.ObjectId };
type TransportLike = TransportCost & { _id: Types.ObjectId };

const ITINERARY_NOT_FOUND = 'Itinerary not found';

/**
 * Itinerary budgets (ITN-14) and intercity transport costs (ITN-16). Only the itinerary's owner adds,
 * edits or deletes amounts (ACC-11); a private itinerary answers 404 to anyone else, exactly like an
 * unknown id. Amounts are stored in the currency the user chose and converted only for display (PAY-04),
 * with the newest cached daily rate.
 */
@Injectable()
export class BudgetsService {
  constructor(
    @InjectModel(BudgetEntry.name)
    private readonly entries: Model<BudgetEntry>,
    @InjectModel(TransportCost.name)
    private readonly transports: Model<TransportCost>,
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    @InjectModel(Activity.name) private readonly activities: Model<Activity>,
    @Inject(CURRENCY_SERVICE) private readonly currency: CurrencyService,
    @Inject(REFERENCE_SERVICE) private readonly reference: ReferenceService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async addEntry(
    user: AuthUser,
    itineraryId: string,
    dayId: string,
    dto: CreateBudgetEntryDto,
  ): Promise<BudgetEntryDto> {
    const itinerary = await this.loadOwned(user, itineraryId);
    this.assertDay(itinerary, dayId, 'dayId', true);
    await this.assertCurrency(dto.currency);
    const entry = await this.entries.create({
      itineraryId: itinerary._id,
      dayId: new Types.ObjectId(dayId),
      category: dto.category,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      note: dto.note ?? '',
    });
    return toEntryDto(entry);
  }

  async updateEntry(
    user: AuthUser,
    id: string,
    dto: UpdateBudgetEntryDto,
  ): Promise<BudgetEntryDto> {
    const entry = await this.loadEntry(user, id);
    if (dto.currency !== undefined) await this.assertCurrency(dto.currency);
    // Built field by field from validated values (never the raw body), so no operator can reach the query.
    const set: Partial<BudgetEntry> = {};
    if (dto.category !== undefined) {
      set.category = Object.values(BudgetCategory).find(
        (c) => c === dto.category,
      );
    }
    if (dto.amountMinor !== undefined)
      set.amountMinor = Number(dto.amountMinor);
    if (dto.currency !== undefined) set.currency = String(dto.currency);
    if (dto.note !== undefined) set.note = String(dto.note);
    const updated = await this.entries
      .findOneAndUpdate(
        { _id: entry._id },
        { $set: set },
        { new: true, runValidators: true },
      )
      .lean<EntryLike>()
      .exec();
    if (!updated) throw notFound('Budget entry not found');
    return toEntryDto(updated);
  }

  async removeEntry(user: AuthUser, id: string): Promise<void> {
    const entry = await this.loadEntry(user, id);
    await this.entries.deleteOne({ _id: entry._id }).exec();
  }

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
    // Built field by field from validated values (never the raw body), so no operator can reach the query.
    const set: Partial<TransportCost> = {};
    if (dto.dayId !== undefined) set.dayId = new Types.ObjectId(dto.dayId);
    if (dto.mode !== undefined) {
      set.mode = Object.values(TransportMode).find((m) => m === dto.mode);
    }
    if (dto.fromCityId !== undefined) set.fromCityId = String(dto.fromCityId);
    if (dto.toCityId !== undefined) set.toCityId = String(dto.toCityId);
    if (dto.amountMinor !== undefined)
      set.amountMinor = Number(dto.amountMinor);
    if (dto.currency !== undefined) set.currency = String(dto.currency);
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

  /**
   * Totals by category and by day, converted to the platform currency (ITN-18 adds the caller's
   * preferred currency). Budget entries, activity costs (under ACTIVITIES) and intercity transport
   * all count. Amounts on a day that no longer exists are left out.
   */
  async summary(
    user: AuthUser,
    itineraryId: string,
  ): Promise<BudgetSummaryDto> {
    const itinerary = await this.loadViewable(user, itineraryId);

    const [entries, transports, activities] = await Promise.all([
      this.entries
        .find({ itineraryId: itinerary._id })
        .lean<EntryLike[]>()
        .exec(),
      this.transports
        .find({ itineraryId: itinerary._id })
        .lean<TransportLike[]>()
        .exec(),
      this.activities
        .find({ itineraryId: itinerary._id, costMinor: { $gt: 0 } })
        .lean<(Activity & { _id: Types.ObjectId })[]>()
        .exec(),
    ]);

    const platform = this.config.get('PLATFORM_CURRENCY', { infer: true });
    const currency = platform;
    const items: BudgetItem[] = [
      ...entries.map((e) => ({
        dayId: e.dayId.toHexString(),
        category: e.category,
        amountMinor: e.amountMinor,
        currency: e.currency,
      })),
      ...activities.map((a) => ({
        dayId: a.dayId.toHexString(),
        category: BudgetCategory.Activities,
        amountMinor: a.costMinor ?? 0,
        currency: a.currency ?? platform,
      })),
      ...transports.map((t) => ({
        dayId: t.dayId.toHexString(),
        category: INTERCITY_TRANSPORT,
        amountMinor: t.amountMinor,
        currency: t.currency,
      })),
    ];

    const days = [...itinerary.days].sort((a, b) => a.order - b.order);
    const byDay = new Map<string, DayTotalDto>(
      days.map((d) => [
        d._id.toHexString(),
        {
          dayId: d._id.toHexString(),
          order: d.order,
          date: itineraryDayDate(itinerary.startDate, d.order),
          cityId: d.cityId,
          byCategory: emptyByCategory(),
          totalMinor: 0,
        },
      ]),
    );
    const byCategory = emptyByCategory();
    let totalMinor = 0;

    for (const group of groupBudgetItems(items)) {
      const day = byDay.get(group.dayId);
      if (!day || group.amountMinor === 0) continue;
      let converted = group.amountMinor;
      if (group.currency !== currency) {
        const result = await this.currency.convert(
          group.amountMinor,
          group.currency,
          currency,
        );
        converted = result.amountMinor;
      }
      day.byCategory[group.category] += converted;
      day.totalMinor += converted;
      byCategory[group.category] += converted;
      totalMinor += converted;
    }

    return {
      itineraryId: itinerary._id.toHexString(),
      currency,
      totalMinor,
      byCategory,
      byDay: [...byDay.values()],
    };
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

  /** The owner, or anyone when the itinerary is public and not hidden (GEN-10). */
  private async loadViewable(
    user: AuthUser,
    itineraryId: string,
  ): Promise<ItineraryLike> {
    const itinerary = await this.itineraries
      .findById(itineraryId)
      .lean<ItineraryLike>()
      .exec();
    if (!itinerary) throw notFound(ITINERARY_NOT_FOUND);
    if (isOwner(user, itinerary.ownerId)) return itinerary;
    const visible =
      itinerary.visibility === ItineraryVisibility.Public &&
      itinerary.isHidden !== true;
    if (!visible) throw notFound(ITINERARY_NOT_FOUND);
    return itinerary;
  }

  private async loadEntry(user: AuthUser, id: string): Promise<EntryLike> {
    const entry = await this.entries.findById(id).lean<EntryLike>().exec();
    if (!entry) throw notFound('Budget entry not found');
    await this.loadOwned(
      user,
      entry.itineraryId.toHexString(),
      'Budget entry not found',
    );
    return entry;
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

function toEntryDto(e: EntryLike): BudgetEntryDto {
  return {
    id: e._id.toHexString(),
    itineraryId: e.itineraryId.toHexString(),
    dayId: e.dayId.toHexString(),
    category: e.category,
    amountMinor: e.amountMinor,
    currency: e.currency,
    note: e.note ?? '',
  };
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

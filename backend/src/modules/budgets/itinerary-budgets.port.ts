import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type {
  ItineraryBudgets,
  ItineraryDayBudget,
} from '../../common/contracts/services.contract';
import { TransportCost } from './schemas/transport-cost.schema';

/** The rows of one budget collection that belong to itineraries (they all have these fields). */
interface BudgetRow {
  itineraryId: Types.ObjectId;
  dayId: Types.ObjectId;
  amountMinor: number;
  currency: string;
}

/**
 * ITINERARY_BUDGETS (common/contracts): what the itineraries module needs from budgets without importing
 * it. Day subtotals (ITN-09) sum each day's rows per currency, unconverted; deleting days or an
 * itinerary (ITN-07, ITN-01) removes their rows; cloning (ITN-21) copies the rows onto the clone's days.
 */
@Injectable()
export class ItineraryBudgetsPort implements ItineraryBudgets {
  constructor(
    @InjectModel(TransportCost.name)
    private readonly transports: Model<TransportCost>,
  ) {}

  /** The budget collections that hang off itinerary days. */
  private get collections(): Model<BudgetRow>[] {
    return [this.transports as unknown as Model<BudgetRow>];
  }

  async dayTotals(itineraryId: string): Promise<ItineraryDayBudget[]> {
    if (!Types.ObjectId.isValid(itineraryId)) return [];
    const itinerary = new Types.ObjectId(itineraryId);
    const sums = new Map<string, Map<string, number>>();
    for (const model of this.collections) {
      const rows = await model
        .aggregate<{
          _id: { dayId: Types.ObjectId; currency: string };
          amountMinor: number;
        }>([
          { $match: { itineraryId: itinerary } },
          {
            $group: {
              _id: { dayId: '$dayId', currency: '$currency' },
              amountMinor: { $sum: '$amountMinor' },
            },
          },
        ])
        .exec();
      for (const row of rows) {
        const day = row._id.dayId.toHexString();
        const perCurrency = sums.get(day) ?? new Map<string, number>();
        perCurrency.set(
          row._id.currency,
          (perCurrency.get(row._id.currency) ?? 0) + row.amountMinor,
        );
        sums.set(day, perCurrency);
      }
    }
    return [...sums].map(([dayId, perCurrency]) => ({
      dayId,
      amounts: [...perCurrency]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, amountMinor]) => ({ currency, amountMinor })),
    }));
  }

  async deleteForDays(itineraryId: string, dayIds: string[]): Promise<void> {
    const days = dayIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (!Types.ObjectId.isValid(itineraryId) || days.length === 0) return;
    for (const model of this.collections) {
      await model
        .deleteMany({
          itineraryId: new Types.ObjectId(itineraryId),
          dayId: { $in: days },
        })
        .exec();
    }
  }

  async deleteForItinerary(itineraryId: string): Promise<void> {
    if (!Types.ObjectId.isValid(itineraryId)) return;
    for (const model of this.collections) {
      await model
        .deleteMany({ itineraryId: new Types.ObjectId(itineraryId) })
        .exec();
    }
  }

  async cloneForItinerary(
    sourceId: string,
    targetId: string,
    dayIdMap: ReadonlyMap<string, string>,
  ): Promise<void> {
    if (
      !Types.ObjectId.isValid(sourceId) ||
      !Types.ObjectId.isValid(targetId)
    ) {
      return;
    }
    for (const model of this.collections) {
      const rows = await model
        .find({ itineraryId: new Types.ObjectId(sourceId) })
        .lean<(BudgetRow & { _id: Types.ObjectId })[]>()
        .exec();
      const copies = rows.flatMap((row) => {
        const day = dayIdMap.get(row.dayId.toHexString());
        if (!day) return [];
        // Copy every field but the identity and timestamps; point it at the clone and its day.
        const copy: Record<string, unknown> = { ...row };
        delete copy._id;
        delete copy.createdAt;
        delete copy.updatedAt;
        return [
          {
            ...copy,
            itineraryId: new Types.ObjectId(targetId),
            dayId: new Types.ObjectId(day),
          },
        ];
      });
      if (copies.length) await model.insertMany(copies);
    }
  }
}

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../../common/auth/auth.types';
import { REFERENCE_SERVICE } from '../../common/contracts/tokens';
import type { ReferenceService } from '../../common/contracts/services.contract';
import {
  AppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { AddDayDto, UpdateDayDto } from './dto/day.dto';
import type { ItineraryDto } from './dto/itinerary.dto';
import { ItinerariesService } from './itineraries.service';
import {
  Itinerary,
  ItineraryDocument,
  MAX_ITINERARY_DAYS,
} from './schemas/itinerary.schema';

/** How often a day change is retried when another change to the same itinerary won the race. */
const MAX_ATTEMPTS = 3;

export const dayNotFound = (): AppException =>
  new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Day not found');

/** A stored day as written back: its _id is kept so activities (dayId) stay attached. */
interface StoredDay {
  _id: Types.ObjectId;
  order: number;
  cityId: string;
  notes: string;
}

/**
 * Itinerary days (ITN-05). Days are embedded, numbered 1..n with no gaps and
 * at most 60; their dates are derived from the start date and are never stored, so renumbering is all
 * it takes to move every date (ITN-07, ITN-08). Each change rewrites the day list in one update guarded by the
 * itinerary's revision (__v), so two concurrent changes can never leave gaps, duplicates or a 61st
 * day: the loser re-reads and retries, and only gives up with 409 after MAX_ATTEMPTS.
 */
@Injectable()
export class ItineraryDaysService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<Itinerary>,
    private readonly itineraryService: ItinerariesService,
    @Inject(REFERENCE_SERVICE) private readonly reference: ReferenceService,
  ) {}

  /** ITN-05: appends a day in a city from the predefined list; 409 once the itinerary has 60 days. */
  async addDay(
    user: AuthUser,
    itineraryId: string,
    dto: AddDayDto,
  ): Promise<ItineraryDto> {
    await this.assertCity(dto.cityId);
    const saved = await this.rewriteDays(user, itineraryId, (days) => {
      if (days.length >= MAX_ITINERARY_DAYS) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.ITINERARY_DAY_LIMIT,
          `An itinerary has at most ${MAX_ITINERARY_DAYS} days`,
        );
      }
      return [
        ...days,
        {
          _id: new Types.ObjectId(),
          order: days.length + 1,
          cityId: dto.cityId,
          notes: dto.notes ?? '',
        },
      ];
    });
    return this.itineraryService.toDetail(saved);
  }

  /** ITN-05: changes a day's city (from the predefined list) or notes. */
  async updateDay(
    user: AuthUser,
    itineraryId: string,
    dayId: string,
    dto: UpdateDayDto,
  ): Promise<ItineraryDto> {
    if (dto.cityId === undefined && dto.notes === undefined) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'Send at least one of cityId, notes',
      );
    }
    if (dto.cityId !== undefined) await this.assertCity(dto.cityId);
    const saved = await this.rewriteDays(user, itineraryId, (days) => {
      const index = indexOfDay(days, dayId);
      return days.map((day, i) =>
        i === index
          ? {
              ...day,
              cityId: dto.cityId ?? day.cityId,
              notes: dto.notes ?? day.notes,
            }
          : day,
      );
    });
    return this.itineraryService.toDetail(saved);
  }

  /**
   * Loads the owner's itinerary (404 for anyone else, ACC-11), lets `change` compute the new day list
   * from the current one, and writes it only if nobody changed the itinerary meanwhile.
   */
  private async rewriteDays(
    user: AuthUser,
    itineraryId: string,
    change: (days: StoredDay[]) => StoredDay[],
  ): Promise<ItineraryDocument> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const itinerary = await this.itineraryService.loadOwned(
        user,
        itineraryId,
      );
      const current: StoredDay[] = [...itinerary.days]
        .sort((a, b) => a.order - b.order)
        .map((day) => ({
          _id: day._id,
          order: day.order,
          cityId: day.cityId,
          notes: day.notes ?? '',
        }));
      const next = change(current);
      const saved = await this.itineraries
        .findOneAndUpdate(
          {
            _id: itinerary._id,
            ownerId: itinerary.ownerId,
            __v: itinerary.__v,
          },
          { $set: { days: next }, $inc: { __v: 1 } },
          { new: true, runValidators: true },
        )
        .exec();
      if (saved) return saved;
    }
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.CONFLICT,
      'The itinerary was changed at the same time. Reload it and try again',
    );
  }

  private async assertCity(cityId: string): Promise<void> {
    if (!(await this.reference.getCity(cityId))) {
      throw new ValidationFailedException([
        {
          field: 'cityId',
          message: `Unknown city "${cityId}". Use a city id from GET /api/cities`,
        },
      ]);
    }
  }
}

function indexOfDay(days: readonly StoredDay[], dayId: string): number {
  const index = days.findIndex((day) => day._id.toHexString() === dayId);
  if (index < 0) throw dayNotFound();
  return index;
}

import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { assertOwner } from '../../common/auth/access';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  ITINERARY_BUDGETS,
  REFERENCE_SERVICE,
  UPLOADS_SERVICE,
} from '../../common/contracts/tokens';
import type {
  ItineraryBudgets,
  MoneyAmount,
  ReferenceService,
  UploadsService,
} from '../../common/contracts/services.contract';
import {
  AppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import type { FieldError } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { paginate, type Page } from '../../common/pagination/pagination';
import type {
  CreateItineraryDto,
  ItineraryDto,
  ItinerarySummaryDto,
  UpdateItineraryDto,
} from './dto/itinerary.dto';
import {
  type ItineraryLike,
  toItineraryDto,
  toItinerarySummaryDto,
} from './itinerary-view';
import { Activity } from './schemas/activity.schema';
import {
  Itinerary,
  ItineraryDocument,
  ItineraryVisibility,
} from './schemas/itinerary.schema';

const EDITABLE_FIELDS = [
  'title',
  'countries',
  'startDate',
  'visibility',
] as const;

/** One message for an unknown id and for someone else's private itinerary (ACC-11). */
export const ITINERARY_NOT_FOUND = 'Itinerary not found';

export const itineraryNotFound = (): AppException =>
  new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    ITINERARY_NOT_FOUND,
  );

/**
 * Itineraries (ITN-01, ITN-03, ITN-20). Every rule lives here so it holds for any caller (GEN-13):
 * countries come from the reference list, an itinerary is private by default, and only its owner
 * can read or change it through these endpoints. A stranger gets the same 404 as for an id that does
 * not exist, so private itineraries cannot even be detected.
 */
@Injectable()
export class ItinerariesService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<Itinerary>,
    @InjectModel(Activity.name) private readonly activities: Model<Activity>,
    @Inject(REFERENCE_SERVICE) private readonly reference: ReferenceService,
    @Inject(UPLOADS_SERVICE) private readonly uploads: UploadsService,
    @InjectConnection() private readonly connection: Connection,
    @Optional()
    @Inject(ITINERARY_BUDGETS)
    private readonly budgets?: ItineraryBudgets,
  ) {}

  /** ITN-01: creates an itinerary with no days yet, private unless the body says PUBLIC. */
  async create(user: AuthUser, dto: CreateItineraryDto): Promise<ItineraryDto> {
    await this.assertCountries(dto.countries);
    const itinerary = await this.itineraries.create({
      ownerId: new Types.ObjectId(user.id),
      title: dto.title,
      countries: dto.countries,
      startDate: dto.startDate,
      visibility: dto.visibility ?? ItineraryVisibility.Private,
      days: [],
    });
    return this.toDetail(itinerary);
  }

  /** ITN-03: the caller's own itineraries, most recently updated first, 10 per page (GEN-05). */
  async listMine(
    user: AuthUser,
    page: number,
  ): Promise<Page<ItinerarySummaryDto>> {
    const result = await paginate(
      this.itineraries,
      { ownerId: new Types.ObjectId(user.id) },
      page,
      { sort: { updatedAt: -1 } },
    );
    return {
      ...result,
      items: result.items.map((it) =>
        toItinerarySummaryDto(it as ItineraryLike),
      ),
    };
  }

  /** ITN-03: full details of one of the caller's itineraries. */
  async getMine(user: AuthUser, id: string): Promise<ItineraryDto> {
    return this.toDetail(await this.loadOwned(user, id));
  }

  /**
   * ITN-01 / ITN-20: edits title, countries, start date or visibility in one validated write. Day dates
   * are derived from the start date, so moving it moves every day. Setting PRIVATE removes the
   * itinerary from the public search at once, because that search filters on visibility per request.
   */
  async update(
    user: AuthUser,
    id: string,
    dto: UpdateItineraryDto,
  ): Promise<ItineraryDto> {
    if (EDITABLE_FIELDS.every((field) => dto[field] === undefined)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        `Send at least one of ${EDITABLE_FIELDS.join(', ')}`,
      );
    }
    await this.loadOwned(user, id);
    if (dto.countries !== undefined) await this.assertCountries(dto.countries);

    const changes: Partial<Itinerary> = {};
    for (const field of EDITABLE_FIELDS) {
      if (dto[field] !== undefined)
        Object.assign(changes, { [field]: dto[field] });
    }
    const updated = await this.itineraries
      .findOneAndUpdate(
        { _id: id, ownerId: new Types.ObjectId(user.id) },
        { $set: changes },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) throw itineraryNotFound();
    return this.toDetail(updated);
  }

  /**
   * ITN-01: deletes the itinerary with its activities, their image files and its budget rows. It
   * leaves the public search at once. Clones made by other users are separate documents and keep
   * everything, including images they share with the original (a file is deleted only when no
   * activity points at it any more).
   */
  async remove(user: AuthUser, id: string): Promise<void> {
    const itinerary = await this.loadOwned(user, id);
    const activities = await this.activities
      .find({ itineraryId: itinerary._id }, { images: 1 })
      .lean()
      .exec();
    // The itinerary and its activities go together or not at all, so a crash cannot leave orphan
    // activities. Budget rows (the port takes no session) and files are removed only after the commit.
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const deleted = await this.itineraries
          .deleteOne(
            { _id: itinerary._id, ownerId: itinerary.ownerId },
            { session },
          )
          .exec();
        if (deleted.deletedCount === 0) throw itineraryNotFound();
        await this.activities
          .deleteMany({ itineraryId: itinerary._id }, { session })
          .exec();
      });
    } finally {
      await session.endSession();
    }
    await this.budgets?.deleteForItinerary(itinerary.id as string);
    await this.deleteUnusedImages(activities.flatMap((a) => a.images ?? []));
  }

  /**
   * Loads an itinerary the caller owns. An unknown id and another user's itinerary both give the same
   * 404 (ACC-11), so a stranger learns nothing. Reused by the day and activity services.
   */
  async loadOwned(
    user: AuthUser,
    id: string | Types.ObjectId,
  ): Promise<ItineraryDocument> {
    const itinerary = Types.ObjectId.isValid(id)
      ? await this.itineraries.findById(id).exec()
      : null;
    if (!itinerary) throw itineraryNotFound();
    assertOwner(user, itinerary.ownerId, {
      notFound: true,
      notFoundMessage: ITINERARY_NOT_FOUND,
    });
    return itinerary;
  }

  /** Builds the ITN-03 detail view: days with derived dates, city names and activities, and the
   * ITN-09 city groups with their budget subtotals. */
  async toDetail(
    itinerary: ItineraryDocument | ItineraryLike,
  ): Promise<ItineraryDto> {
    const plain =
      'toObject' in itinerary && typeof itinerary.toObject === 'function'
        ? itinerary.toObject()
        : itinerary;
    const [activities, cityNames, dayBudgets] = await Promise.all([
      this.activities
        .find({ itineraryId: plain._id })
        .sort({ createdAt: 1, _id: 1 })
        .lean()
        .exec(),
      this.cityNames(plain.days.map((day) => day.cityId)),
      this.dayBudgets(plain._id.toHexString()),
    ]);
    return toItineraryDto(plain, { activities, cityNames, dayBudgets });
  }

  /** Marks the itinerary as just updated after a change to one of its activities (ITN-03 order). */
  async touch(id: Types.ObjectId): Promise<void> {
    await this.itineraries
      .updateOne(
        { _id: id },
        { $set: { updatedAt: new Date() } },
        { timestamps: false },
      )
      .exec();
  }

  /** Deletes the files of these image URLs unless an activity (e.g. a clone's) still uses them. */
  async deleteUnusedImages(urls: readonly string[]): Promise<void> {
    for (const url of new Set(urls)) {
      const stillUsed = await this.activities.exists({ images: url }).exec();
      if (!stillUsed) await this.uploads.deleteImage(url);
    }
  }

  /** ITN-14/ITN-16 totals per day from the budgets module; empty until it provides the port. */
  private async dayBudgets(
    itineraryId: string,
  ): Promise<Map<string, MoneyAmount[]>> {
    const totals = (await this.budgets?.dayTotals(itineraryId)) ?? [];
    return new Map(totals.map((t) => [t.dayId, t.amounts]));
  }

  private async cityNames(
    cityIds: readonly string[],
  ): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    for (const cityId of new Set(cityIds)) {
      const city = await this.reference.getCity(cityId);
      if (city) names.set(cityId, city.name);
    }
    return names;
  }

  /** ITN-01: every country must come from the predefined list (GEN-12); 400 names each bad one. */
  private async assertCountries(countries: readonly string[]): Promise<void> {
    const errors: FieldError[] = [];
    for (const [i, code] of countries.entries()) {
      if (!(await this.reference.getCountry(code))) {
        errors.push({
          field: `countries[${i}]`,
          message: `Unknown country "${code}". Use a country code from GET /api/countries`,
        });
      }
    }
    if (errors.length) throw new ValidationFailedException(errors);
  }
}

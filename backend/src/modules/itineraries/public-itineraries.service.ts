import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, Types } from 'mongoose';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  ACCOUNT_ADMIN,
  ITINERARY_BUDGETS,
  REFERENCE_SERVICE,
  VISIBLE_CONTENT_FILTER,
} from '../../common/contracts';
import type {
  AccountAdmin,
  ItineraryBudgets,
  ReferenceService,
} from '../../common/contracts/services.contract';
import { paginate, type Page } from '../../common/pagination/pagination';
import { UsersService } from '../users';
import type { ItineraryDto } from './dto/itinerary.dto';
import type {
  ItineraryAuthorDto,
  PublicItineraryDto,
  PublicItinerarySearchQueryDto,
  PublicItinerarySummaryDto,
} from './dto/search.dto';
import { ItinerariesService, itineraryNotFound } from './itineraries.service';
import {
  type ItineraryLike,
  sumByCurrency,
  toItinerarySummaryDto,
} from './itinerary-view';
import { Activity } from './schemas/activity.schema';
import {
  Itinerary,
  ItineraryDocument,
  ItineraryVisibility,
} from './schemas/itinerary.schema';
import { runInTransaction } from '../../common/utils/transaction';

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/** Shown when an author's account no longer exists (the itinerary stays public). */
export const UNKNOWN_AUTHOR = 'Former member';

/**
 * Public itineraries (ITN-20, ITN-21). Only PUBLIC itineraries that an admin has not hidden (GEN-10)
 * and whose owner has not deactivated their account (ACC-12) are found or shown, and the filter is applied on every request, so making an itinerary private or
 * deleting it removes it from the search at once. Public itineraries are read-only here; a registered
 * user may clone one into an independent private copy that credits its author.
 */
@Injectable()
export class PublicItinerariesService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<Itinerary>,
    @InjectModel(Activity.name) private readonly activities: Model<Activity>,
    private readonly itineraryService: ItinerariesService,
    @Inject(REFERENCE_SERVICE) private readonly reference: ReferenceService,
    @Inject(ACCOUNT_ADMIN) private readonly accounts: AccountAdmin,
    private readonly users: UsersService,
    @InjectConnection() private readonly connection: Connection,
    @Optional()
    @Inject(ITINERARY_BUDGETS)
    private readonly budgets?: ItineraryBudgets,
  ) {}

  /**
   * ITN-21: keyword (title, country or city), country, city and duration filters, most recently
   * updated first, 10 per page (GEN-05). An empty page is the "no results" state.
   */
  async search(
    query: PublicItinerarySearchQueryDto,
  ): Promise<Page<PublicItinerarySummaryDto>> {
    const and: FilterQuery<Itinerary>[] = [];
    if (query.q) and.push({ $or: await this.keywordMatches(query.q) });
    if (query.country) and.push({ countries: query.country });
    if (query.city) and.push({ 'days.cityId': query.city });
    if (query.minDays !== undefined) {
      and.push({ $expr: { $gte: [{ $size: '$days' }, query.minDays] } });
    }
    if (query.maxDays !== undefined) {
      and.push({ $expr: { $lte: [{ $size: '$days' }, query.maxDays] } });
    }
    const filter: FilterQuery<Itinerary> = {
      ...(await this.publicFilter()),
      ...(and.length ? { $and: and } : {}),
    };
    const page = await paginate(this.itineraries, filter, query.page, {
      sort: { updatedAt: -1 },
    });
    const items: PublicItinerarySummaryDto[] = [];
    for (const it of page.items as ItineraryLike[]) {
      items.push({
        ...toItinerarySummaryDto(it),
        author: await this.authorOf(it.ownerId),
        cityIds: [...new Set(it.days.map((day) => day.cityId))],
      });
    }
    return { ...page, items };
  }

  /** ITN-21: a public itinerary, read-only, with its author, days, activities and budget. */
  async getPublic(id: string): Promise<PublicItineraryDto> {
    const itinerary = await this.loadPublic(id);
    const detail = await this.itineraryService.toDetail(itinerary);
    return {
      ...detail,
      author: await this.authorOf(itinerary.ownerId),
      budgetTotal: sumByCurrency(
        detail.cityGroups.flatMap((group) => group.subtotals),
      ),
    };
  }

  /**
   * ITN-21: copies a public itinerary into a new PRIVATE itinerary of the caller, with every day (new
   * ids, same order, city and notes), activity (images included) and budget row. It credits the
   * author of the itinerary it was copied from, and shares nothing else with it: later changes or
   * the deletion of either one never affect the other (ITN-01).
   */
  async clone(user: AuthUser, id: string): Promise<ItineraryDto> {
    const source = await this.loadPublic(id);
    const author = await this.authorOf(source.ownerId);
    const dayIdMap = new Map<string, string>();
    const days = [...source.days]
      .sort((a, b) => a.order - b.order)
      .map((day) => {
        const newId = new Types.ObjectId();
        dayIdMap.set(day._id.toHexString(), newId.toHexString());
        return {
          _id: newId,
          order: day.order,
          cityId: day.cityId,
          notes: day.notes ?? '',
        };
      });

    // The copy and its activities are written in one transaction, so a failure never leaves a
    // half-copied itinerary. Budget rows go through the port (no session) after the commit; if that
    // fails, the copy is removed again.
    const copyId = new Types.ObjectId();
    await runInTransaction(this.connection, async (session) => {
      await this.itineraries.create(
        [
          {
            _id: copyId,
            ownerId: new Types.ObjectId(user.id),
            title: source.title,
            countries: [...source.countries],
            startDate: source.startDate,
            visibility: ItineraryVisibility.Private,
            days,
            clonedFrom: {
              itineraryId: source._id,
              authorId: source.ownerId,
              authorName: author.name,
            },
          },
        ],
        { session },
      );
      const activities = await this.activities
        .find({ itineraryId: source._id }, null, { session })
        .sort({ createdAt: 1, _id: 1 })
        .lean()
        .exec();
      const copies = activities
        .filter((a) => dayIdMap.has(a.dayId.toHexString()))
        .map((a) => ({
          itineraryId: copyId,
          dayId: new Types.ObjectId(dayIdMap.get(a.dayId.toHexString())),
          name: a.name,
          description: a.description,
          time: a.time,
          costMinor: a.costMinor,
          currency: a.currency,
          images: [...(a.images ?? [])],
        }));
      if (copies.length) {
        await this.activities.insertMany(copies, { session });
      }
    });
    try {
      await this.budgets?.cloneForItinerary(
        source.id as string,
        copyId.toHexString(),
        dayIdMap,
      );
    } catch (err) {
      await this.budgets?.deleteForItinerary(copyId.toHexString());
      await this.activities.deleteMany({ itineraryId: copyId }).exec();
      await this.itineraries.deleteOne({ _id: copyId }).exec();
      throw err;
    }
    const copy = await this.itineraries.findById(copyId).exec();
    if (!copy) throw itineraryNotFound();
    return this.itineraryService.toDetail(copy);
  }

  /**
   * PUBLIC, not hidden by an admin (GEN-10), and not owned by a deactivated account (ACC-12: "their
   * public itineraries are hidden"). The deactivated ids come from a count-checked cache (TRVL-181).
   */
  private async publicFilter(): Promise<FilterQuery<Itinerary>> {
    const deactivated = await this.users.deactivatedIds();
    return {
      visibility: ItineraryVisibility.Public,
      ...VISIBLE_CONTENT_FILTER,
      ...(deactivated.length
        ? { ownerId: { $nin: deactivated.map((id) => new Types.ObjectId(id)) } }
        : {}),
    };
  }

  /** A public, not hidden itinerary; anything else is the same 404 as an unknown id. */
  private async loadPublic(id: string): Promise<ItineraryDocument> {
    const itinerary = Types.ObjectId.isValid(id)
      ? await this.itineraries
          .findOne({ _id: id, ...(await this.publicFilter()) })
          .exec()
      : null;
    if (!itinerary) throw itineraryNotFound();
    return itinerary;
  }

  private async authorOf(ownerId: Types.ObjectId): Promise<ItineraryAuthorDto> {
    const id = ownerId.toHexString();
    const account = await this.accounts.find(id);
    return { id, name: account?.name ?? UNKNOWN_AUTHOR };
  }

  /** ITN-21: the keyword matches the title, a country (code or name) or a city (id or name). */
  private async keywordMatches(q: string): Promise<FilterQuery<Itinerary>[]> {
    const text = new RegExp(q.replace(REGEX_SPECIALS, '\\$&'), 'i');
    const [countries, cities] = await Promise.all([
      this.reference.listCountries(),
      this.reference.listCities(),
    ]);
    const countryCodes = countries
      .filter((c) => text.test(c.name) || c.code === q.toUpperCase())
      .map((c) => c.code);
    const cityIds = cities
      .filter((c) => text.test(c.name) || text.test(c.cityId))
      .map((c) => c.cityId);
    return [
      { title: text },
      ...(countryCodes.length ? [{ countries: { $in: countryCodes } }] : []),
      ...(cityIds.length ? [{ 'days.cityId': { $in: cityIds } }] : []),
    ];
  }
}

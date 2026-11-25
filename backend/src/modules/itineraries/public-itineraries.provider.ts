import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type {
  PublicItineraries,
  PublicItinerarySummary,
} from '../../common/contracts/services.contract';
import { paginate } from '../../common/pagination/pagination';
import { Itinerary, ItineraryVisibility } from './schemas/itinerary.schema';

type SummaryRow = {
  _id: Types.ObjectId;
  title: string;
  countries: string[];
  startDate: string;
  days?: unknown[];
};

function toSummary(r: SummaryRow): PublicItinerarySummary {
  return {
    id: r._id.toHexString(),
    title: r.title,
    countries: r.countries,
    startDate: r.startDate,
    days: r.days?.length ?? 0,
  };
}

/**
 * PUBLIC_ITINERARIES (common/contracts): an author's public itineraries for the blog's author page
 * (BLG-12). Only PUBLIC ones an admin has not hidden (ITN-20, GEN-10), newest update first.
 */
@Injectable()
export class PublicItinerariesProvider implements PublicItineraries {
  constructor(
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
  ) {}

  async ofAuthor(
    authorId: string,
    page: number,
  ): Promise<{ items: PublicItinerarySummary[]; total: number }> {
    if (!Types.ObjectId.isValid(authorId)) return { items: [], total: 0 };
    const filter = {
      ownerId: new Types.ObjectId(authorId),
      visibility: ItineraryVisibility.Public,
      isHidden: { $ne: true },
    };
    const { items: rows, total } = await paginate<Itinerary, SummaryRow>(
      this.itineraries,
      filter,
      page,
      {
        sort: { updatedAt: -1 },
        projection: { title: 1, countries: 1, startDate: 1, days: 1 },
      },
    );
    return { items: rows.map(toSummary), total };
  }

  /** BLG-13: the author's own or a public itinerary, never one an admin hid (GEN-10). */
  async attachable(authorId: string, itineraryId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(authorId)) return false;
    if (!Types.ObjectId.isValid(itineraryId)) return false;
    const found = await this.itineraries
      .exists({
        _id: new Types.ObjectId(itineraryId),
        isHidden: { $ne: true },
        $or: [
          { ownerId: new Types.ObjectId(authorId) },
          { visibility: ItineraryVisibility.Public },
        ],
      })
      .exec();
    return found !== null;
  }

  async summaries(ids: string[]): Promise<Map<string, PublicItinerarySummary>> {
    const valid = [...new Set(ids)]
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (valid.length === 0) return new Map();
    const rows = await this.itineraries
      .find(
        {
          _id: { $in: valid },
          visibility: ItineraryVisibility.Public,
          isHidden: { $ne: true },
        },
        { title: 1, countries: 1, startDate: 1, days: 1 },
      )
      .lean<SummaryRow[]>()
      .exec();
    return new Map(rows.map((r) => [r._id.toHexString(), toSummary(r)]));
  }
}

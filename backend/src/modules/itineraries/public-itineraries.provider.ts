import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type {
  PublicItineraries,
  PublicItinerarySummary,
} from '../../common/contracts/services.contract';
import { PAGE_SIZE, skipFor } from '../../common/pagination/pagination';
import { Itinerary, ItineraryVisibility } from './schemas/itinerary.schema';

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
    const [rows, total] = await Promise.all([
      this.itineraries
        .find(filter, { title: 1, countries: 1, startDate: 1, days: 1 })
        .sort({ updatedAt: -1, _id: -1 })
        .skip(skipFor(page))
        .limit(PAGE_SIZE)
        .lean<
          {
            _id: Types.ObjectId;
            title: string;
            countries: string[];
            startDate: string;
            days?: unknown[];
          }[]
        >()
        .exec(),
      this.itineraries.countDocuments(filter).exec(),
    ]);
    return {
      items: rows.map((r) => ({
        id: r._id.toHexString(),
        title: r.title,
        countries: r.countries,
        startDate: r.startDate,
        days: r.days?.length ?? 0,
      })),
      total,
    };
  }
}

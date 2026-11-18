import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  CONTENT_MODERATION,
  ModeratableContentType,
  type ContentModeration,
  type ModeratableContent,
  type ModeratableContentAdapter,
} from '../../common/contracts';
import { Activity } from './schemas/activity.schema';
import { Itinerary, ItineraryVisibility } from './schemas/itinerary.schema';

/**
 * Itineraries as moderatable content (GEN-09 reports, GEN-10 hide/delete). A PRIVATE itinerary is not
 * public (ITN-20), so only its owner can report it; everyone else gets the 404 of an unknown id.
 */
@Injectable()
export class ItineraryModerationAdapter
  implements ModeratableContentAdapter, OnModuleInit
{
  readonly type = ModeratableContentType.Itinerary;

  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<Itinerary>,
    @InjectModel(Activity.name) private readonly activities: Model<Activity>,
    @Optional()
    @Inject(CONTENT_MODERATION)
    private readonly moderation?: ContentModeration,
  ) {}

  onModuleInit(): void {
    this.moderation?.register(this);
  }

  async find(
    id: string,
    session?: ClientSession,
  ): Promise<ModeratableContent | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const itinerary = await this.itineraries
      .findById(id, { ownerId: 1, visibility: 1, isHidden: 1 })
      .session(session ?? null)
      .lean()
      .exec();
    if (!itinerary) return null;
    return {
      id: itinerary._id.toHexString(),
      authorId: itinerary.ownerId.toHexString(),
      isHidden: itinerary.isHidden === true,
      isPublic: itinerary.visibility === ItineraryVisibility.Public,
    };
  }

  async setHidden(
    id: string,
    hidden: boolean,
    session: ClientSession,
  ): Promise<boolean> {
    const res = await this.itineraries
      .updateOne(
        { _id: id, isHidden: hidden ? { $ne: true } : true },
        { $set: { isHidden: hidden } },
        { session },
      )
      .exec();
    return res.modifiedCount === 1;
  }

  /** Deletes the itinerary and its activities in the caller's transaction (as ITN-01 delete does). */
  async remove(id: string, session: ClientSession): Promise<boolean> {
    const res = await this.itineraries
      .deleteOne({ _id: id }, { session })
      .exec();
    if (res.deletedCount === 0) return false;
    await this.activities.deleteMany({ itineraryId: id }, { session }).exec();
    return true;
  }
}

import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  CONTENT_MODERATION,
  ITINERARY_BUDGETS,
  ModeratableContentType,
  type ContentModeration,
  type ItineraryBudgets,
  type ModeratableContent,
  type ModeratableContentAdapter,
  type RemovedContent,
} from '../../common/contracts';
import { ItinerariesService } from './itineraries.service';
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
    private readonly itinerariesService: ItinerariesService,
    @Optional()
    @Inject(CONTENT_MODERATION)
    private readonly moderation?: ContentModeration,
    @Optional()
    @Inject(ITINERARY_BUDGETS)
    private readonly budgets?: ItineraryBudgets,
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
    if (!Types.ObjectId.isValid(id)) return false;
    const res = await this.itineraries
      .updateOne(
        { _id: id, isHidden: hidden ? { $ne: true } : true },
        { $set: { isHidden: hidden } },
        { session },
      )
      .exec();
    return res.modifiedCount === 1;
  }

  /**
   * Deletes the itinerary and its activities in the caller's transaction. Like the ITN-01 delete, budget
   * rows (that port takes no session) and image files go only after the commit, through afterCommit().
   */
  async remove(
    id: string,
    session: ClientSession,
  ): Promise<RemovedContent | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const activities = await this.activities
      .find({ itineraryId: id }, { images: 1 })
      .session(session)
      .lean()
      .exec();
    const res = await this.itineraries
      .deleteOne({ _id: id }, { session })
      .exec();
    if (res.deletedCount === 0) return null;
    await this.activities.deleteMany({ itineraryId: id }, { session }).exec();
    const images = activities.flatMap((a) => a.images ?? []);
    return {
      afterCommit: async () => {
        await this.budgets?.deleteForItinerary(id);
        await this.itinerariesService.deleteUnusedImages(images);
      },
    };
  }
}

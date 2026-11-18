import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  REFERENCE_SERVICE,
  UPLOAD_LIMITS,
  UPLOADS_SERVICE,
} from '../../common/contracts';
import type {
  ReferenceService,
  UploadedFileLike,
  UploadsService,
} from '../../common/contracts/services.contract';
import {
  AppException,
  ValidationFailedException,
  type FieldError,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { localUploadUrlPattern } from '../../common/validation';
import type { CreateActivityDto, UpdateActivityDto } from './dto/activity.dto';
import type { ActivityDto } from './dto/itinerary.dto';
import { ItinerariesService } from './itineraries.service';
import { dayNotFound } from './itinerary-days.service';
import { toActivityDto } from './itinerary-view';
import { Activity, ActivityDocument } from './schemas/activity.schema';

/** An activity image this backend stored (GEN-08); group 2 is its image id. */
const ACTIVITY_UPLOAD_URL = localUploadUrlPattern(['activities']);
const IMAGE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_IMAGES = UPLOAD_LIMITS.maxImagesPerEntity;

const EDITABLE_FIELDS = [
  'name',
  'description',
  'time',
  'costMinor',
  'currency',
  'removeTime',
  'removeCost',
] as const;

export const ACTIVITY_NOT_FOUND = 'Activity not found';
const activityNotFound = (): AppException =>
  new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    ACTIVITY_NOT_FOUND,
  );

/**
 * Activities of itinerary days (ITN-10) and their images (ITN-12, GEN-08). An activity belongs to its
 * itinerary's owner: anyone else gets the same 404 as for an unknown activity (ACC-11). Each change
 * also marks the itinerary as updated, so "my itineraries" stays sorted by the latest change (ITN-03).
 */
@Injectable()
export class ActivitiesService {
  constructor(
    @InjectModel(Activity.name) private readonly activities: Model<Activity>,
    private readonly itineraryService: ItinerariesService,
    @Inject(REFERENCE_SERVICE) private readonly reference: ReferenceService,
    @Inject(UPLOADS_SERVICE) private readonly uploads: UploadsService,
  ) {}

  /** ITN-10: adds an activity to one of the itinerary's days. */
  async create(
    user: AuthUser,
    itineraryId: string,
    dayId: string,
    dto: CreateActivityDto,
  ): Promise<ActivityDto> {
    const itinerary = await this.itineraryService.loadOwned(user, itineraryId);
    if (!itinerary.days.some((day) => day._id.toHexString() === dayId)) {
      throw dayNotFound();
    }
    await this.assertCost(dto.costMinor, dto.currency);
    const activity = await this.activities.create({
      itineraryId: itinerary._id,
      dayId: new Types.ObjectId(dayId),
      name: dto.name,
      description: dto.description,
      time: dto.time,
      costMinor: dto.costMinor,
      currency: dto.currency,
      images: [],
    });
    await this.itineraryService.touch(itinerary._id);
    return toActivityDto(activity.toObject());
  }

  /** ITN-10: edits name, description, time or cost; removeTime / removeCost clear the optional ones. */
  async update(
    user: AuthUser,
    id: string,
    dto: UpdateActivityDto,
  ): Promise<ActivityDto> {
    if (EDITABLE_FIELDS.every((field) => dto[field] === undefined)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        `Send at least one of ${EDITABLE_FIELDS.join(', ')}`,
      );
    }
    const errors: FieldError[] = [];
    if (dto.removeTime && dto.time !== undefined) {
      errors.push({
        field: 'removeTime',
        message: 'Send either time or removeTime, not both',
      });
    }
    if (
      dto.removeCost &&
      (dto.costMinor !== undefined || dto.currency !== undefined)
    ) {
      errors.push({
        field: 'removeCost',
        message: 'Send either costMinor/currency or removeCost, not both',
      });
    }
    if (errors.length) throw new ValidationFailedException(errors);

    const activity = await this.loadOwned(user, id);
    if (dto.costMinor !== undefined || dto.currency !== undefined) {
      await this.assertCost(
        dto.costMinor ?? activity.costMinor,
        dto.currency ?? activity.currency,
      );
    }

    const $set: Partial<Activity> = {};
    const $unset: Record<string, ''> = {};
    for (const field of [
      'name',
      'description',
      'time',
      'costMinor',
      'currency',
    ] as const) {
      if (dto[field] !== undefined)
        Object.assign($set, { [field]: dto[field] });
    }
    if (dto.removeTime) $unset.time = '';
    if (dto.removeCost) Object.assign($unset, { costMinor: '', currency: '' });

    const updated = await this.activities
      .findOneAndUpdate(
        { _id: activity._id },
        { $set, ...(Object.keys($unset).length ? { $unset } : {}) },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) throw activityNotFound();
    await this.itineraryService.touch(activity.itineraryId);
    return toActivityDto(updated.toObject());
  }

  /** ITN-10: deletes the activity and the files of its images that no other activity uses. */
  async remove(user: AuthUser, id: string): Promise<void> {
    const activity = await this.loadOwned(user, id);
    const deleted = await this.activities
      .deleteOne({ _id: activity._id })
      .exec();
    if (deleted.deletedCount === 0) throw activityNotFound();
    await this.itineraryService.deleteUnusedImages(activity.images);
    await this.itineraryService.touch(activity.itineraryId);
  }

  /**
   * ITN-12 / GEN-08: adds uploaded JPG/PNG images, at most 5 per activity. The files are checked and
   * written first, then added with one conditional $push that only matches while there is still room
   * for all of them, so concurrent uploads cannot pass the limit; on any failure the files are deleted.
   */
  async addImages(
    user: AuthUser,
    id: string,
    files: UploadedFileLike[],
  ): Promise<ActivityDto> {
    const activity = await this.loadOwned(user, id);
    const stored = await this.uploads.saveImages(files, {
      entityType: 'ACTIVITY',
      entityId: id,
      existingCount: activity.images.length,
    });
    const urls = stored.map((image) => image.url);
    let updated: ActivityDocument | null;
    try {
      updated = await this.activities
        .findOneAndUpdate(
          {
            _id: activity._id,
            $expr: { $lte: [{ $size: '$images' }, MAX_IMAGES - urls.length] },
          },
          { $push: { images: { $each: urls } } },
          { new: true },
        )
        .exec();
    } catch (err) {
      await this.discard(urls);
      throw err;
    }
    if (!updated) {
      await this.discard(urls);
      await this.loadOwned(user, id); // 404 if it was deleted meanwhile
      throw new ValidationFailedException([
        {
          field: 'images',
          message: `An activity can have at most ${MAX_IMAGES} images, and other images were added at the same time. Reload and try again`,
        },
      ]);
    }
    await this.itineraryService.touch(activity.itineraryId);
    return toActivityDto(updated.toObject());
  }

  /**
   * ITN-12 / GEN-08: removes one image from the activity. Its file is deleted unless another activity
   * (a clone, ITN-21) still shows it.
   */
  async removeImage(
    user: AuthUser,
    id: string,
    imageId: string,
  ): Promise<ActivityDto> {
    if (!IMAGE_ID.test(imageId)) {
      throw new ValidationFailedException([
        {
          field: 'imageId',
          message: 'imageId must be the id returned by the upload (a UUID)',
        },
      ]);
    }
    const activity = await this.loadOwned(user, id);
    const url = activity.images.find(
      (image) => ACTIVITY_UPLOAD_URL.exec(image)?.[2] === imageId,
    );
    const updated = url
      ? await this.activities
          .findOneAndUpdate(
            { _id: activity._id, images: url },
            { $pull: { images: url } },
            { new: true },
          )
          .exec()
      : null;
    if (!url || !updated) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Image not found',
      );
    }
    await this.itineraryService.deleteUnusedImages([url]);
    await this.itineraryService.touch(activity.itineraryId);
    return toActivityDto(updated.toObject());
  }

  /** Loads an activity of one of the caller's itineraries; 404 (same message) for anyone else. */
  private async loadOwned(
    user: AuthUser,
    id: string,
  ): Promise<ActivityDocument> {
    const activity = Types.ObjectId.isValid(id)
      ? await this.activities.findById(id).exec()
      : null;
    if (!activity) throw activityNotFound();
    try {
      await this.itineraryService.loadOwned(user, activity.itineraryId);
    } catch (err) {
      // Someone else's itinerary: answer exactly like an unknown activity.
      if (err instanceof AppException && err.getStatus() === 404) {
        throw activityNotFound();
      }
      throw err;
    }
    return activity;
  }

  /** ITN-10: a cost needs a currency from the supported list, and the other way round. */
  private async assertCost(
    costMinor: number | undefined,
    currency: string | undefined,
  ): Promise<void> {
    if (costMinor === undefined && currency === undefined) return;
    if (costMinor === undefined || currency === undefined) {
      throw new ValidationFailedException([
        {
          field: costMinor === undefined ? 'costMinor' : 'currency',
          message: 'costMinor and currency must be sent together',
        },
      ]);
    }
    const supported = await this.reference.listCurrencies();
    if (!supported.some((c) => c.code === currency)) {
      throw new ValidationFailedException([
        {
          field: 'currency',
          message: `Unsupported currency "${currency}". Use a code from GET /api/currencies`,
        },
      ]);
    }
  }

  private async discard(urls: string[]): Promise<void> {
    for (const url of urls) await this.uploads.deleteImage(url);
  }
}

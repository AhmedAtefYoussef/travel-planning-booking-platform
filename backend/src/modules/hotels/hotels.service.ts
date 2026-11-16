import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { assertProviderScope } from '../../common/auth/access';
import { AuthUser, ProviderType, Role } from '../../common/auth/auth.types';
import { ACTIVE_PROVIDER_FILTER } from '../../common/contracts';
import { cancellationTierFieldErrors } from '../../common/contracts/policies.contract';
import {
  REFERENCE_SERVICE,
  UPLOADS_SERVICE,
} from '../../common/contracts/tokens';
import type {
  ReferenceService,
  UploadedFileLike,
  UploadsService,
} from '../../common/contracts/services.contract';
import {
  AppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { localUploadUrlPattern } from '../../common/validation';
import type { CreateHotelDto, HotelDto, UpdateHotelDto } from './dto/hotel.dto';
import {
  MAX_HOTEL_CANCELLATION_TIERS,
  type SetHotelPoliciesDto,
} from './dto/hotel-policy.dto';
import { Hotel, HotelDocument, MAX_HOTEL_PHOTOS } from './schemas/hotel.schema';

/** A hotel photo this backend stored (GEN-08); group 2 is its image id. */
const HOTEL_UPLOAD_URL = localUploadUrlPattern(['hotels']);
const IMAGE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const EDITABLE_FIELDS = [
  'name',
  'address',
  'cityId',
  'description',
  'photos',
  'starClass',
  'amenities',
] as const;

/**
 * Hotel profiles (HTL-01). Rules live here, not in the controller, so they hold for every caller
 * (GEN-13): the city must exist in the reference data and gives the hotel its country, and only
 * the moderator assigned to a hotel may edit it (ACC-11, brief section 4).
 */
@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @Inject(REFERENCE_SERVICE) private readonly reference: ReferenceService,
    @Inject(UPLOADS_SERVICE) private readonly uploads: UploadsService,
  ) {}

  async create(dto: CreateHotelDto): Promise<HotelDto> {
    const countryCode = await this.countryOfCity(dto.cityId);
    const hotel = await this.hotels.create({
      name: dto.name,
      address: dto.address,
      cityId: dto.cityId,
      countryCode,
      description: dto.description ?? '',
      photos: dto.photos ?? [],
      starClass: dto.starClass,
      amenities: dto.amenities ?? [],
    });
    return toHotelDto(hotel);
  }

  /**
   * HTL-01: the assigned moderator edits the profile. The scope is checked before the hotel is read, so
   * a moderator of another hotel learns nothing about this one (not even whether it is deactivated).
   * The write is one atomic update that only matches an active hotel, so an admin deactivating the
   * hotel at the same moment cannot be overwritten or missed (ACC-15).
   */
  async update(
    user: AuthUser,
    id: string,
    dto: UpdateHotelDto,
  ): Promise<HotelDto> {
    assertProviderScope(user, ProviderType.Hotel, id);
    if (EDITABLE_FIELDS.every((field) => dto[field] === undefined)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        `Send at least one of ${EDITABLE_FIELDS.join(', ')}`,
      );
    }
    const changes: Partial<Hotel> = {};
    for (const field of EDITABLE_FIELDS) {
      if (dto[field] !== undefined)
        Object.assign(changes, { [field]: dto[field] });
    }
    if (dto.cityId !== undefined) {
      changes.countryCode = await this.countryOfCity(dto.cityId);
    }
    const hotel = await this.hotels
      .findOneAndUpdate(
        { _id: id, ...ACTIVE_PROVIDER_FILTER },
        { $set: changes },
        { new: true, runValidators: true },
      )
      .exec();
    if (hotel) return toHotelDto(hotel);
    await this.loadManaged(user, id);
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.CONFLICT,
      'The hotel changed while it was being edited. Try again',
    );
  }

  /**
   * HTL-09 + HTL-10: the assigned moderator replaces the hotel's policy: the standard check-in and
   * check-out times (hotel local time) and the cancellation tiers.
   * Same order and atomicity as `update`: scope first (403 before any read), then the tier rules shared
   * with FLT-09 (unique thresholds, 400 with fieldErrors), then one validated write that only matches
   * an active hotel. Tiers are stored sorted by threshold. Existing reservations keep the tiers they
   * accepted (PAY-02 snapshot), so a change only affects future bookings.
   */
  async setPolicies(
    user: AuthUser,
    id: string,
    dto: SetHotelPoliciesDto,
  ): Promise<HotelDto> {
    assertProviderScope(user, ProviderType.Hotel, id);
    // Checked here rather than with @ArrayMaxSize, so a missing list gives one field error (GEN-02).
    if (dto.cancellationTiers.length > MAX_HOTEL_CANCELLATION_TIERS) {
      throw new ValidationFailedException([
        {
          field: 'cancellationTiers',
          message: `cancellationTiers can hold at most ${MAX_HOTEL_CANCELLATION_TIERS} tiers`,
        },
      ]);
    }
    const errors = cancellationTierFieldErrors(
      dto.cancellationTiers,
      'cancellationTiers',
    );
    if (errors.length) throw new ValidationFailedException(errors);
    const cancellationTiers = [...dto.cancellationTiers]
      .sort((a, b) => a.daysBefore - b.daysBefore)
      .map((t) => ({
        daysBefore: t.daysBefore,
        refundPercent: t.refundPercent,
      }));
    const hotel = await this.hotels
      .findOneAndUpdate(
        { _id: id, ...ACTIVE_PROVIDER_FILTER },
        {
          $set: {
            checkInTime: dto.checkInTime,
            checkOutTime: dto.checkOutTime,
            cancellationTiers,
          },
        },
        { new: true, runValidators: true },
      )
      .exec();
    if (hotel) return toHotelDto(hotel);
    // Not matched: 404 for an unknown hotel, 403 for a deactivated one, else a concurrent change.
    await this.loadManaged(user, id);
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.CONFLICT,
      'The hotel changed while its policies were being set. Try again',
    );
  }

  /**
   * For read-only moderator views (HTL-08): 403 if `user` does not manage the hotel (checked before
   * any read, ACC-11), then 404 if it does not exist. A deactivated hotel stays readable (ACC-15).
   */
  async loadInScope(
    user: AuthUser,
    id: string | Types.ObjectId,
  ): Promise<HotelDocument> {
    assertProviderScope(user, ProviderType.Hotel, id);
    return this.load(id);
  }

  /** Loads a hotel or throws 404; other hotel services reuse it. */
  async load(id: string | Types.ObjectId): Promise<HotelDocument> {
    const hotel = await this.hotels.findById(id).exec();
    if (!hotel) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Hotel not found',
      );
    }
    return hotel;
  }

  /**
   * Loads a hotel that `user` may change, checking in this order so nothing leaks to other providers:
   * 403 if the user doesn't manage it (ACC-11, no database read), 404 if it doesn't exist, then 403 if
   * an admin has deactivated it (ACC-15). Its existing data stays readable; it just can't be changed.
   */
  async loadManaged(
    user: AuthUser,
    id: string | Types.ObjectId,
  ): Promise<HotelDocument> {
    assertProviderScope(user, ProviderType.Hotel, id);
    const hotel = await this.load(id);
    if (!hotel.isActive) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'This hotel is deactivated (ACC-15), so it cannot be changed',
      );
    }
    return hotel;
  }

  /**
   * GEN-08 / HTL-01: adds uploaded JPG/PNG photos (up to MAX_HOTEL_PHOTOS in all). The files are checked
   * and written first, then added with one conditional $push that only matches while the hotel still has
   * room for all of them, so two concurrent uploads can never take it past the limit. The request that
   * loses gets 400 and its files are deleted again, as on any other failure after they were written.
   */
  async addImages(
    user: AuthUser,
    id: string,
    files: UploadedFileLike[],
  ): Promise<HotelDto> {
    const hotel = await this.loadForImages(user, id);
    const stored = await this.uploads.saveImages(files, {
      entityType: 'HOTEL',
      entityId: id,
      existingCount: hotel.photos.length,
    });
    const urls = stored.map((image) => image.url);
    let updated: HotelDocument | null;
    try {
      updated = await this.hotels
        .findOneAndUpdate(
          {
            _id: id,
            ...this.writableFilter(user),
            $expr: {
              $lte: [{ $size: '$photos' }, MAX_HOTEL_PHOTOS - urls.length],
            },
          },
          { $push: { photos: { $each: urls } } },
          { new: true },
        )
        .exec();
    } catch (err) {
      await this.discard(urls);
      throw err;
    }
    if (updated) return toHotelDto(updated);
    await this.discard(urls);
    // 404/403 if the hotel was deleted or deactivated meanwhile; otherwise another upload filled it.
    await this.loadForImages(user, id);
    throw new ValidationFailedException([
      {
        field: 'images',
        message: `A hotel can have at most ${MAX_HOTEL_PHOTOS} photos, and other photos were added at the same time. Reload and try again`,
      },
    ]);
  }

  /**
   * GEN-08 / HTL-01: removes one uploaded photo from the hotel and deletes its file, unless another
   * hotel's photo list still points at the same file (a moderator can PATCH any uploaded hotel URL in).
   */
  async removeImage(
    user: AuthUser,
    id: string,
    imageId: string,
  ): Promise<HotelDto> {
    if (!IMAGE_ID.test(imageId)) {
      throw new ValidationFailedException([
        {
          field: 'imageId',
          message: 'imageId must be the id returned by the upload (a UUID)',
        },
      ]);
    }
    const hotel = await this.loadForImages(user, id);
    const url = hotel.photos.find(
      (photo) => HOTEL_UPLOAD_URL.exec(photo)?.[2] === imageId,
    );
    const updated = url
      ? await this.hotels
          .findOneAndUpdate(
            { _id: id, ...this.writableFilter(user), photos: url },
            { $pull: { photos: url } },
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
    const stillUsed = await this.hotels.exists({ photos: url }).exec();
    if (!stillUsed) await this.uploads.deleteImage(url);
    return toHotelDto(updated);
  }

  /** Admins may manage any hotel's images; a moderator only their own, active hotel (ACC-11, ACC-15). */
  private loadForImages(user: AuthUser, id: string): Promise<HotelDocument> {
    return user.role === Role.Admin
      ? this.load(id)
      : this.loadManaged(user, id);
  }

  private writableFilter(user: AuthUser): Record<string, unknown> {
    return user.role === Role.Admin ? {} : { ...ACTIVE_PROVIDER_FILTER };
  }

  private async discard(urls: string[]): Promise<void> {
    for (const url of urls) await this.uploads.deleteImage(url);
  }

  /**
   * The hotel's IANA time zone, taken from an airport in the same city (every seeded city has one),
   * or null when the city has none. Used to decide which nights are "from today on" (HTL-05).
   */
  async timeZoneOf(cityId: string): Promise<string | null> {
    const airports = await this.reference.listAirports();
    return airports.find((a) => a.cityId === cityId)?.timeZone ?? null;
  }

  private async countryOfCity(cityId: string): Promise<string> {
    const city = await this.reference.getCity(cityId);
    if (!city) {
      // GEN-02: a field error, like unknown airports in flights, so a form can mark the city field.
      throw new ValidationFailedException([
        {
          field: 'cityId',
          message: `Unknown city "${cityId}". Use a city id from GET /api/cities`,
        },
      ]);
    }
    return city.countryCode;
  }
}

export function toHotelDto(hotel: HotelDocument): HotelDto {
  return {
    id: hotel.id as string,
    name: hotel.name,
    address: hotel.address,
    cityId: hotel.cityId,
    countryCode: hotel.countryCode,
    description: hotel.description,
    photos: [...hotel.photos],
    starClass: hotel.starClass ?? null,
    amenities: [...hotel.amenities],
    checkInTime: hotel.checkInTime ?? null,
    checkOutTime: hotel.checkOutTime ?? null,
    cancellationTiers: (hotel.cancellationTiers ?? []).map((t) => ({
      daysBefore: t.daysBefore,
      refundPercent: t.refundPercent,
    })),
    isActive: hotel.isActive,
    createdAt: hotel.createdAt,
    updatedAt: hotel.updatedAt,
  };
}

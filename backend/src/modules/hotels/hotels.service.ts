import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { assertProviderScope } from '../../common/auth/access';
import { AuthUser, ProviderType } from '../../common/auth/auth.types';
import { REFERENCE_SERVICE } from '../../common/contracts/tokens';
import type { ReferenceService } from '../../common/contracts/services.contract';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { CreateHotelDto, HotelDto, UpdateHotelDto } from './dto/hotel.dto';
import { Hotel, HotelDocument } from './hotel.schema';

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

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateHotelDto,
  ): Promise<HotelDto> {
    const hotel = await this.loadActive(id);
    assertProviderScope(user, ProviderType.Hotel, hotel._id);
    if (EDITABLE_FIELDS.every((field) => dto[field] === undefined)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        `Send at least one of ${EDITABLE_FIELDS.join(', ')}`,
      );
    }
    if (dto.cityId !== undefined && dto.cityId !== hotel.cityId) {
      hotel.countryCode = await this.countryOfCity(dto.cityId);
      hotel.cityId = dto.cityId;
    }
    if (dto.name !== undefined) hotel.name = dto.name;
    if (dto.address !== undefined) hotel.address = dto.address;
    if (dto.description !== undefined) hotel.description = dto.description;
    if (dto.photos !== undefined) hotel.photos = dto.photos;
    if (dto.starClass !== undefined) hotel.starClass = dto.starClass;
    if (dto.amenities !== undefined) hotel.amenities = dto.amenities;
    await hotel.save();
    return toHotelDto(hotel);
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
   * Loads a hotel that may still be managed: 404 if it doesn't exist, 403 if an admin has deactivated
   * it (ACC-15). Its existing data stays readable; it just can't be changed.
   */
  async loadActive(id: string | Types.ObjectId): Promise<HotelDocument> {
    const hotel = await this.load(id);
    if (!hotel.active) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'This hotel is deactivated (ACC-15), so its profile cannot be changed',
      );
    }
    return hotel;
  }

  private async countryOfCity(cityId: string): Promise<string> {
    const city = await this.reference.getCity(cityId);
    if (!city) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        `Unknown city "${cityId}". Use a city id from GET /api/cities`,
      );
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
    active: hotel.active,
    createdAt: hotel.createdAt,
    updatedAt: hotel.updatedAt,
  };
}

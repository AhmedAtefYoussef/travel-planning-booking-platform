import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuthUser } from '../../common/contracts/auth.contract';
import { UPLOADS_SERVICE } from '../../common/contracts/tokens';
import type {
  UploadedImageFile,
  UploadsService,
} from '../../common/contracts/uploads.contract';
import { assertOwnHotel } from './hotel-access';
import { Hotel, HotelDocument, MAX_HOTEL_PHOTOS } from './hotel.schema';

/** The stored image id is the file name without its extension. */
export function photoIdOf(url: string): string {
  const file = url.split('/').pop() ?? '';
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

/** HTL-01: up to 5 photos per hotel, stored through the shared uploads service (GEN-08). */
@Injectable()
export class HotelPhotosService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    @Inject(UPLOADS_SERVICE) private readonly uploads: UploadsService,
  ) {}

  async add(
    hotelId: string,
    files: UploadedImageFile[],
    user: AuthUser | undefined,
  ): Promise<{ photos: string[] }> {
    assertOwnHotel(user, hotelId);
    if (!files || files.length === 0) {
      throw new BadRequestException('Attach at least one image in "photos"');
    }
    const hotel = await this.hotels.findById(hotelId);
    if (!hotel) throw new NotFoundException('Hotel not found');

    const room = MAX_HOTEL_PHOTOS - hotel.photos.length;
    if (files.length > room) {
      throw new BadRequestException(
        `A hotel can have at most ${MAX_HOTEL_PHOTOS} photos (${room} free)`,
      );
    }
    const stored = await this.uploads.saveImages(files, { max: room });
    hotel.photos = [...hotel.photos, ...stored.map((s) => s.url)];
    await hotel.save();
    return { photos: hotel.photos };
  }

  async remove(
    hotelId: string,
    photoId: string,
    user: AuthUser | undefined,
  ): Promise<{ photos: string[] }> {
    assertOwnHotel(user, hotelId);
    const hotel = await this.hotels.findById(hotelId);
    if (!hotel) throw new NotFoundException('Hotel not found');

    const url = hotel.photos.find((p) => photoIdOf(p) === photoId);
    if (!url) throw new NotFoundException('Photo not found');

    await this.uploads.deleteImage(photoId);
    hotel.photos = hotel.photos.filter((p) => p !== url);
    await hotel.save();
    return { photos: hotel.photos };
  }
}

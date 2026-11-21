import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Model } from 'mongoose';
import type { ProviderState, ProviderStatus } from '../../common/contracts';
import { Hotel } from './schemas/hotel.schema';

/**
 * HOTEL_STATUS implementation (ACC-15). Only `isActive` changes: hotel listings filter on it
 * (ACTIVE_PROVIDER_FILTER), and HOTEL_INVENTORY refuses new holds on an inactive hotel, while Confirmed
 * reservations and their booked nights are untouched.
 */
@Injectable()
export class HotelStatusService implements ProviderStatus {
  constructor(@InjectModel(Hotel.name) private readonly hotels: Model<Hotel>) {}

  async find(
    providerId: string,
    session?: ClientSession,
  ): Promise<ProviderState | null> {
    if (!Types.ObjectId.isValid(providerId)) return null;
    const hotel = await this.hotels
      .findById(providerId)
      .select('name isActive')
      .session(session ?? null)
      .lean()
      .exec();
    if (!hotel) return null;
    return { id: providerId, name: hotel.name, isActive: hotel.isActive };
  }

  async setActive(
    providerId: string,
    active: boolean,
    session: ClientSession,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(providerId)) return false;
    const res = await this.hotels
      .updateOne(
        { _id: new Types.ObjectId(providerId), isActive: !active },
        { $set: { isActive: active } },
        { session },
      )
      .exec();
    return res.modifiedCount === 1;
  }
}

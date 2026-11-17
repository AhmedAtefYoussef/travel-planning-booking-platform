import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Model } from 'mongoose';
import type { ProviderState, ProviderStatus } from '../../common/contracts';
import { Airline } from './schemas/airline.schema';

/**
 * AIRLINE_STATUS implementation (ACC-15). Only `isActive` changes: flight search filters on it, and
 * FLIGHT_INVENTORY refuses new holds on an inactive airline, while Confirmed bookings are untouched.
 */
@Injectable()
export class AirlineStatusService implements ProviderStatus {
  constructor(
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
  ) {}

  async find(
    providerId: string,
    session?: ClientSession,
  ): Promise<ProviderState | null> {
    if (!Types.ObjectId.isValid(providerId)) return null;
    const airline = await this.airlines
      .findById(providerId)
      .select('name isActive')
      .session(session ?? null)
      .lean()
      .exec();
    if (!airline) return null;
    return { id: providerId, name: airline.name, isActive: airline.isActive };
  }

  async setActive(
    providerId: string,
    active: boolean,
    session: ClientSession,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(providerId)) return false;
    const res = await this.airlines
      .updateOne(
        { _id: new Types.ObjectId(providerId), isActive: !active },
        { $set: { isActive: active } },
        { session },
      )
      .exec();
    return res.modifiedCount === 1;
  }
}

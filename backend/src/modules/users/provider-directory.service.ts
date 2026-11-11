import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection } from 'mongoose';
import { ProviderType } from '../../common/auth/auth.types';

/**
 * Provider collections by their names in docs/architecture/erd.md (`airlines`: TRVL-138, `hotels`:
 * TRVL-140). Read-only and by name, so the users module never imports the flights or hotels modules.
 */
export const PROVIDER_COLLECTIONS: Readonly<Record<ProviderType, string>> = {
  [ProviderType.Airline]: 'airlines',
  [ProviderType.Hotel]: 'hotels',
};

export interface ProviderSummary {
  id: string;
  name: string;
  isActive: boolean;
}

/** ACC-13: checks that the airline or hotel a new moderator is linked to really exists. */
@Injectable()
export class ProviderDirectoryService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async find(
    type: ProviderType,
    id: string,
    session?: ClientSession,
  ): Promise<ProviderSummary | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.connection
      .collection(PROVIDER_COLLECTIONS[type])
      .findOne(
        { _id: new Types.ObjectId(id) },
        { projection: { name: 1, isActive: 1 }, session },
      );
    if (!doc) return null;
    return {
      id,
      name: String(doc.name),
      isActive: doc.isActive !== false,
    };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type {
  ReferenceSeedResult,
  SeedCollectionResult,
} from './dto/reference.dto';
import { Airport } from './schemas/airport.schema';
import { Attraction } from './schemas/attraction.schema';
import { City } from './schemas/city.schema';
import { Country } from './schemas/country.schema';
import { Currency } from './schemas/currency.schema';
import type { ReferenceDataset } from './seed/reference-dataset';

/**
 * Writes the validated reference dataset (GEN-12). Each record is upserted by its dataset id, so
 * running `npm run seed` again updates names or time zones in place and never creates duplicates.
 * Records are never deleted: flights, hotels and itineraries may already reference them.
 */
@Injectable()
export class ReferenceSeedService {
  private readonly logger = new Logger(ReferenceSeedService.name);

  constructor(
    @InjectModel(Country.name) private readonly countries: Model<Country>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
    @InjectModel(Attraction.name)
    private readonly attractions: Model<Attraction>,
    @InjectModel(Currency.name) private readonly currencies: Model<Currency>,
  ) {}

  async seed(dataset: ReferenceDataset): Promise<ReferenceSeedResult> {
    // Parents first, so a partial run never leaves a city without its country.
    const result: ReferenceSeedResult = {
      countries: await this.upsert(this.countries, dataset.countries, 'code'),
      currencies: await this.upsert(
        this.currencies,
        dataset.currencies,
        'code',
      ),
      cities: await this.upsert(this.cities, dataset.cities, 'cityId'),
      airports: await this.upsert(this.airports, dataset.airports, 'iataCode'),
      attractions: await this.upsert(
        this.attractions,
        dataset.attractions,
        'attractionId',
      ),
    };
    for (const [name, r] of Object.entries(result)) {
      this.logger.log(
        `${name}: ${r.total} in dataset, ${r.inserted} inserted, ${r.updated} updated`,
      );
    }
    return result;
  }

  private async upsert<T, R extends object>(
    model: Model<T>,
    records: R[],
    key: keyof R & string,
  ): Promise<SeedCollectionResult> {
    if (records.length === 0) return { total: 0, inserted: 0, updated: 0 };
    const ops = records.map((record) => ({
      updateOne: {
        filter: { [key]: record[key] },
        update: { $set: record },
        upsert: true,
      },
    })) as unknown as Parameters<Model<T>['bulkWrite']>[0];
    const res = await model.bulkWrite(ops, { ordered: true });
    return {
      total: records.length,
      inserted: res.upsertedCount,
      updated: res.modifiedCount,
    };
  }
}

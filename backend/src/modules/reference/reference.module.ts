import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { REFERENCE_SERVICE } from '../../common/contracts';
import { ReferenceSeedService } from './reference-seed.service';
import { ReferenceController } from './reference.controller';
import { ReferenceDataService } from './reference.service';
import { Airport, AirportSchema } from './schemas/airport.schema';
import { Attraction, AttractionSchema } from './schemas/attraction.schema';
import { City, CitySchema } from './schemas/city.schema';
import { Country, CountrySchema } from './schemas/country.schema';
import { Currency, CurrencySchema } from './schemas/currency.schema';

/**
 * Reference data (GEN-12, FLT-02): countries, cities, airports, attractions and currencies seeded from
 * the official datasets. Global so every module can inject REFERENCE_SERVICE without importing this
 * module (docs/architecture/contracts.md).
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Country.name, schema: CountrySchema },
      { name: City.name, schema: CitySchema },
      { name: Airport.name, schema: AirportSchema },
      { name: Attraction.name, schema: AttractionSchema },
      { name: Currency.name, schema: CurrencySchema },
    ]),
  ],
  controllers: [ReferenceController],
  providers: [
    ReferenceDataService,
    ReferenceSeedService,
    { provide: REFERENCE_SERVICE, useExisting: ReferenceDataService },
  ],
  exports: [REFERENCE_SERVICE, ReferenceSeedService],
})
export class ReferenceModule {}

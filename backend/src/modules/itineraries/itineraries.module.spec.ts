import { MODULE_METADATA } from '@nestjs/common/constants';
import { HotelsModule } from '../hotels';
import { ItinerariesModule } from './itineraries.module';

describe('ItinerariesModule wiring (ITN-25)', () => {
  it('imports HotelsModule so the HOTELS_SEARCH it exports reaches the hotel search of a city group', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      ItinerariesModule,
    ) as unknown[];
    expect(imports).toContain(HotelsModule);
  });
});

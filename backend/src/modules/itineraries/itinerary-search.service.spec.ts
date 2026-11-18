import { Role, type AuthUser } from '../../common/auth/auth.types';
import { toPage } from '../../common/pagination/pagination';
import type { ItinerariesService } from './itineraries.service';
import { ItinerarySearchService } from './itinerary-search.service';

const user: AuthUser = { id: '6af0f1c2c77901aa9f228701', role: Role.User };

function detail(cities: string[]) {
  return {
    startDate: '2027-05-01',
    days: cities.map((cityId, i) => ({
      dayNumber: i + 1,
      date: `2027-05-0${i + 1}`,
      cityId,
      cityName: cityId,
    })),
    cityGroups: cities.length
      ? [{ cityId: cities[0], startDate: '2027-05-01', endDate: '2027-05-02' }]
      : [],
  };
}

function setup(cities: string[], opts: { hotels?: boolean } = {}) {
  const itineraryService = {
    getMine: jest.fn(() => Promise.resolve(detail(cities))),
  };
  const hotels = {
    search: jest.fn(() => Promise.resolve(toPage([], 0, 1))),
  };
  const service = new ItinerarySearchService(
    itineraryService as unknown as ItinerariesService,
    opts.hotels === false ? undefined : hotels,
  );
  return { service, hotels };
}

describe('ItinerarySearchService (ITN-25)', () => {
  describe('hotels (ITN-25)', () => {
    it('searches the group city from its first day to the day after its last', async () => {
      const { service, hotels } = setup(['cairo']);
      const res = await service.hotelsForGroup(user, 'id', {
        group: 1,
        guests: 2,
        page: 1,
      });
      expect(hotels.search).toHaveBeenCalledWith({
        cityId: 'cairo',
        checkIn: '2027-05-01',
        checkOut: '2027-05-03',
        guests: 2,
        rooms: 1,
        page: 1,
      });
      expect(res).toMatchObject({ checkOut: '2027-05-03', rooms: 1 });
    });

    it('rejects a missing group, explains an empty itinerary, and 503s without a hotel search', async () => {
      await expect(
        setup(['cairo']).service.hotelsForGroup(user, 'id', {
          group: 2,
          guests: 1,
          page: 1,
        }),
      ).rejects.toMatchObject({ status: 400 });
      const empty = setup([]);
      await expect(
        empty.service.hotelsForGroup(user, 'id', {
          group: 1,
          guests: 1,
          page: 1,
        }),
      ).rejects.toMatchObject({
        fieldErrors: [expect.objectContaining({ field: 'group' })],
      });
      await expect(
        setup(['cairo'], { hotels: false }).service.hotelsForGroup(user, 'id', {
          group: 1,
          guests: 1,
          page: 1,
        }),
      ).rejects.toMatchObject({ status: 503 });
    });
  });
});

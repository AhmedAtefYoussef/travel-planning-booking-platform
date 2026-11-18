import { Role, type AuthUser } from '../../common/auth/auth.types';
import type {
  FlightSearchQuery,
  FlightSearchResult,
  ReferenceService,
} from '../../common/contracts/services.contract';
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

const flightResult = (id: string, departure: string): FlightSearchResult => ({
  flightId: id,
  airlineId: 'a',
  flightNumber: id,
  from: 'X',
  to: 'Y',
  departureUtc: new Date(departure),
  arrivalUtc: new Date(departure),
  durationMinutes: 60,
  cabinClass: 'ECONOMY',
  seatsLeft: 5,
  totalPriceMinor: 100,
});

function setup(
  cities: string[],
  opts: {
    hotels?: boolean;
    airports?: { iataCode: string; cityId: string }[];
  } = {},
) {
  const itineraryService = {
    getMine: jest.fn(() => Promise.resolve(detail(cities))),
  };
  const reference = {
    listAirports: jest.fn(() =>
      Promise.resolve(
        opts.airports ?? [
          { iataCode: 'RUH', cityId: 'riyadh' },
          { iataCode: 'CAI', cityId: 'cairo' },
        ],
      ),
    ),
  } as unknown as ReferenceService;
  const flights = {
    search: jest.fn((q: FlightSearchQuery) => {
      // Route "CAI" has 12 results (2 pages); "SPX" has 1.
      if (q.to === 'CAI') {
        const all = Array.from({ length: 12 }, (_, i) =>
          flightResult(
            `c${i}`,
            `2027-05-01T${String(i + 10).padStart(2, '0')}:00:00Z`,
          ),
        );
        return Promise.resolve(
          toPage(all.slice((q.page - 1) * 10, q.page * 10), 12, q.page),
        );
      }
      return Promise.resolve(
        toPage([flightResult('s0', '2027-05-01T09:00:00Z')], 1, q.page),
      );
    }),
  };
  const hotels = {
    search: jest.fn(() => Promise.resolve(toPage([], 0, 1))),
  };
  const service = new ItinerarySearchService(
    itineraryService as unknown as ItinerariesService,
    reference,
    flights,
    opts.hotels === false ? undefined : hotels,
  );
  return { service, flights, hotels };
}

describe('ItinerarySearchService (ITN-25, ITN-26)', () => {
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

  describe('flights (ITN-26)', () => {
    it('uses the start date and the one destination airport, passing the page through', async () => {
      const { service, flights } = setup(['cairo', 'cairo']);
      const res = await service.flightsToStart(user, 'id', {
        origin: 'RUH',
        page: 2,
      });
      expect(flights.search).toHaveBeenCalledWith({
        from: 'RUH',
        to: 'CAI',
        departureDate: '2027-05-01',
        adults: 1,
        children: 0,
        infants: 0,
        cabinClass: undefined,
        sort: 'departure',
        page: 2,
      });
      expect(res).toMatchObject({ tripType: 'ONE_WAY', return: null });
      expect(res.outbound.items).toHaveLength(2);
    });

    it('round trip returns from the first city on the last day by default', async () => {
      const { service, flights } = setup(['cairo', 'dubai']);
      const res = await service.flightsToStart(user, 'id', {
        origin: 'RUH',
        tripType: 'ROUND_TRIP',
        page: 1,
      });
      expect(res.returnDate).toBe('2027-05-02');
      expect(flights.search).toHaveBeenLastCalledWith(
        expect.objectContaining({
          from: 'CAI',
          to: 'RUH',
          departureDate: '2027-05-02',
        }),
      );
    });

    it('merges every page of several destination airports, earliest first', async () => {
      const { service } = setup(['cairo'], {
        airports: [
          { iataCode: 'RUH', cityId: 'riyadh' },
          { iataCode: 'CAI', cityId: 'cairo' },
          { iataCode: 'SPX', cityId: 'cairo' },
        ],
      });
      const first = await service.flightsToStart(user, 'id', {
        origin: 'RUH',
        page: 1,
      });
      expect(first.destinationAirports).toEqual(['CAI', 'SPX']);
      expect(first.outbound).toMatchObject({ total: 13, totalPages: 2 });
      expect(first.outbound.items[0].flightId).toBe('s0');
      const second = await service.flightsToStart(user, 'id', {
        origin: 'RUH',
        page: 2,
      });
      expect(second.outbound.items.map((f) => f.flightId)).toEqual([
        'c9',
        'c10',
        'c11',
      ]);
    });

    it('rejects an empty itinerary, unknown or same-city origins and bad dates', async () => {
      await expect(
        setup([]).service.flightsToStart(user, 'id', {
          origin: 'RUH',
          page: 1,
        }),
      ).rejects.toMatchObject({ status: 400 });
      const { service } = setup(['cairo']);
      await expect(
        service.flightsToStart(user, 'id', { origin: 'XXX', page: 1 }),
      ).rejects.toMatchObject({
        fieldErrors: [expect.objectContaining({ field: 'origin' })],
      });
      await expect(
        service.flightsToStart(user, 'id', { origin: 'CAI', page: 1 }),
      ).rejects.toMatchObject({
        fieldErrors: [expect.objectContaining({ field: 'origin' })],
      });
      await expect(
        service.flightsToStart(user, 'id', {
          origin: 'RUH',
          returnDate: '2027-05-03',
          page: 1,
        }),
      ).rejects.toMatchObject({
        fieldErrors: [expect.objectContaining({ field: 'returnDate' })],
      });
      await expect(
        service.flightsToStart(user, 'id', {
          origin: 'RUH',
          tripType: 'ROUND_TRIP',
          returnDate: '2027-04-01',
          page: 1,
        }),
      ).rejects.toMatchObject({ status: 400 });
      const noAirport = setup(['luxor']);
      await expect(
        noAirport.service.flightsToStart(user, 'id', {
          origin: 'RUH',
          page: 1,
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });
});

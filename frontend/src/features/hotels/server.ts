import 'server-only';

/** Server-only entry of the hotels feature (data loading and server-rendered views). */
export { listDestinations, type Destination } from './api/places.server';
export {
  searchHotels,
  type HotelResult,
  type SearchOutcome,
} from './api/search.server';
export { SearchResults } from './ui/search-results';

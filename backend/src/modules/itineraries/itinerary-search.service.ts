import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth.types';
import { HOTELS_SEARCH } from '../../common/contracts';
import type { HotelsSearch } from '../../common/contracts/services.contract';
import {
  AppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { addDays } from '../../common/utils/dates';
import type {
  ItineraryHotelsDto,
  ItineraryHotelsQueryDto,
} from './dto/search.dto';
import { ItinerariesService } from './itineraries.service';

/**
 * Searches started from an itinerary (ITN-25). They only work out the search from the caller's own
 * itinerary (404 for anyone else) and hand it to the shared HTL-11 hotel search, so every search rule
 * (dates not in the past, availability, occupancy) is enforced in one place.
 */
@Injectable()
export class ItinerarySearchService {
  constructor(
    private readonly itineraryService: ItinerariesService,
    @Optional()
    @Inject(HOTELS_SEARCH)
    private readonly hotels?: HotelsSearch,
  ) {}

  /**
   * ITN-25: hotels for one city group: check-in on the group's first day, check-out the day after its
   * last day, in the group's city, for the guests and rooms the user enters (HTL-11).
   */
  async hotelsForGroup(
    user: AuthUser,
    id: string,
    query: ItineraryHotelsQueryDto,
  ): Promise<ItineraryHotelsDto> {
    const detail = await this.itineraryService.getMine(user, id);
    const group = detail.cityGroups[query.group - 1];
    if (!group) {
      throw new ValidationFailedException([
        {
          field: 'group',
          message: detail.cityGroups.length
            ? `group must be between 1 and ${detail.cityGroups.length}, the number of city groups`
            : 'This itinerary has no days yet, so it has no city groups',
        },
      ]);
    }
    if (!this.hotels) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.SERVICE_UNAVAILABLE,
        'Hotel search (HTL-11) is not available yet',
      );
    }
    const rooms = query.rooms ?? 1;
    const checkIn = group.startDate;
    const checkOut = addDays(group.endDate, 1);
    const hotels = await this.hotels.search({
      cityId: group.cityId,
      checkIn,
      checkOut,
      guests: query.guests,
      rooms,
      page: query.page,
    });
    return { group, checkIn, checkOut, guests: query.guests, rooms, hotels };
  }
}

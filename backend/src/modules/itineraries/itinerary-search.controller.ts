import { Controller, Param, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { ItineraryDto } from './dto/itinerary.dto';
import { PublicItinerariesService } from './public-itineraries.service';

/** Actions started from one itinerary: cloning a public itinerary (ITN-21). */
@ApiTags('Itineraries')
@Controller('itineraries/:id')
export class ItinerarySearchController {
  constructor(private readonly publicItineraries: PublicItinerariesService) {}

  @Post('clone')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'ITN-21 Clone a public itinerary',
    description:
      'Copies a PUBLIC itinerary (not hidden by an admin) into a new PRIVATE itinerary of the caller: every day (same order, city and notes), activity (with its images) and budget entry. `clonedFrom` credits the author of the itinerary it was copied from. The copy is independent: editing or deleting either one never changes the other. A private, hidden or unknown itinerary is 404.',
  })
  @ApiParam({ name: 'id', description: 'Id of the public itinerary to copy' })
  @ApiCreatedResponse({
    type: ItineraryDto,
    description: 'The new private copy',
  })
  @ApiErrorResponses(400, 404)
  clone(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ItineraryDto> {
    return this.publicItineraries.clone(user, id);
  }
}

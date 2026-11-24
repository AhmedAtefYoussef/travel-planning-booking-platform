import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { FlightStatus } from '../schemas/flight.schema';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * FLT-03 / FE-07: the airline moderator's own flights, 10 per page (GEN-05). Without `status`
 * every flight is listed (Scheduled, Cancelled and Departed), so past and cancelled flights stay
 * reachable for their bookings and passenger list (FLT-29).
 */
export class AirlineFlightsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: FlightStatus,
    description: 'Only flights with this status; omit it to list all of them',
  })
  @IsOptional()
  @Transform(upper)
  @IsEnum(FlightStatus, {
    message: `status must be one of ${Object.values(FlightStatus).join(', ')}`,
  })
  status?: FlightStatus;
}

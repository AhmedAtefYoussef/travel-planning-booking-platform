import { ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { IsCalendarDate, IsRangeEnd } from './validators';

/** Longest window one calendar request covers, in nights (about two months). */
export const MAX_CALENDAR_NIGHTS = 62;

/** HTL-08 night status, as the moderator sees it. */
export enum RoomNightStatus {
  /** Bookable on this night and nobody has it. */
  AVAILABLE = 'AVAILABLE',
  /** A Confirmed reservation; `reference` names it. */
  BOOKED = 'BOOKED',
  /** Blocked by the moderator (HTL-06). */
  BLOCKED = 'BLOCKED',
  /** Held for a reservation awaiting payment (Pending Payment, HTL-18) until `holdExpiresAt`. */
  HELD = 'HELD',
  /** Outside the room's bookable ranges (HTL-04), or the room is deactivated (HTL-06). */
  NOT_BOOKABLE = 'NOT_BOOKABLE',
}

/** HTL-08: the window to show; `to` is exclusive. Rooms are paged 10 at a time (GEN-05). */
export class RoomCalendarQueryDto extends PaginationQueryDto {
  @ApiProperty({ example: '2027-01-01', description: 'First night shown' })
  @IsCalendarDate()
  from!: string;

  @ApiProperty({
    example: '2027-01-15',
    description: `Day after the last night shown; after from, at most ${MAX_CALENDAR_NIGHTS} nights later`,
  })
  @IsCalendarDate()
  @IsRangeEnd('from', MAX_CALENDAR_NIGHTS)
  to!: string;
}

export class RoomCalendarNightDto {
  @ApiProperty({ example: '2027-01-10' })
  date!: string;

  @ApiProperty({ enum: RoomNightStatus, example: RoomNightStatus.BOOKED })
  status!: RoomNightStatus;

  @ApiProperty({
    example: 'HT-7KQ2M9XA',
    nullable: true,
    type: String,
    description: 'Reservation reference for BOOKED nights; null otherwise',
  })
  reference!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    format: 'date-time',
    description: 'When the payment hold ends, for HELD nights; null otherwise',
  })
  holdExpiresAt!: Date | null;
}

export class RoomCalendarDto {
  @ApiProperty({ example: '6720c0a9e4b0a1b2c3d4e5f7' })
  roomId!: string;

  @ApiProperty({ example: '101' })
  number!: string;

  @ApiProperty({ example: 'Double' })
  type!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({
    type: [RoomCalendarNightDto],
    description: 'One entry per night from `from` up to the day before `to`',
  })
  nights!: RoomCalendarNightDto[];
}

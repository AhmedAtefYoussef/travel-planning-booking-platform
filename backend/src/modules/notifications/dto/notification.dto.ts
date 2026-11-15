import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType } from '../../../common/contracts';

/** One in-app notification as its owner sees it (GEN-01). */
export class NotificationDto {
  @ApiProperty({ example: '6af0f1c2c77901aa9f228700' })
  id!: string;

  @ApiProperty({
    enum: Object.values(NotificationType),
    example: NotificationType.BookingConfirmed,
  })
  type!: NotificationType;

  @ApiProperty({ example: 'Booking confirmed', maxLength: 120 })
  title!: string;

  @ApiProperty({
    example:
      'Your flight CAI -> DXB on 2027-12-01 is confirmed (reference TRV-7K2M9Q).',
    maxLength: 1000,
  })
  body!: string;

  @ApiPropertyOptional({
    example: '/bookings/flights/6af0eaaec77901aa9f228660',
    description: 'Frontend route to open; always starts with /',
  })
  link?: string;

  @ApiProperty({
    type: Date,
    nullable: true,
    example: null,
    description: 'When the user read it; null while unread',
  })
  readAt!: Date | null;

  @ApiProperty({ example: '2026-11-15T10:15:30.000Z' })
  createdAt!: Date;
}

export class UnreadCountDto {
  @ApiProperty({
    example: 3,
    description: 'Unread notifications of the caller',
  })
  count!: number;
}

export class MarkAllReadDto {
  @ApiProperty({
    example: 3,
    description:
      'How many unread notifications were marked read (0 when none were)',
  })
  updated!: number;
}

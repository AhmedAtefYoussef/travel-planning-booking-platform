import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

/** Query strings arrive as text: "true"/"false" become booleans, anything else is left for the validator. */
const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

/** GEN-01 list: page only (fixed size 10, GEN-05) and an optional read-state filter. */
export class ListNotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    example: true,
    description:
      'true: only unread notifications; false: only read ones; omitted: all',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'unread must be true or false' })
  unread?: boolean;
}

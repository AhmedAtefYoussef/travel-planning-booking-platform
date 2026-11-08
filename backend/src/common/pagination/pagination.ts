import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import type { FilterQuery, Model, SortOrder } from 'mongoose';

/** GEN-05: every list is paginated with a fixed page size of 10. Clients choose the page only. */
export const PAGE_SIZE = 10;
const MAX_PAGE = 100_000;

/**
 * Query DTO for every list endpoint. Extend it for module-specific filters:
 *   export class FlightSearchQueryDto extends PaginationQueryDto { @IsString() from!: string; ... }
 * There is deliberately no `limit`: with forbidNonWhitelisted, `?limit=50` is a 400 (GEN-05).
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    example: 1,
    description: 'Page number (page size is fixed at 10, GEN-05)',
  })
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === ''
      ? 1
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : typeof value === 'number'
          ? value
          : Number.NaN,
  )
  @IsInt({ message: 'page must be a whole number' })
  @Min(1, { message: 'page must be at least 1' })
  @Max(MAX_PAGE)
  page: number = 1;
}

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Response envelope; use @ApiPaginatedResponse(ItemDto) to document it per endpoint. */
export class PaginatedResponseDto<T> implements Page<T> {
  items!: T[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: PAGE_SIZE, description: 'Always 10 (GEN-05)' })
  limit!: number;

  @ApiProperty({ example: 42 })
  total!: number;

  @ApiProperty({ example: 5 })
  totalPages!: number;
}

export function toPage<T>(items: T[], total: number, page: number): Page<T> {
  return {
    items,
    page,
    limit: PAGE_SIZE,
    total,
    totalPages: Math.ceil(total / PAGE_SIZE),
  };
}

export function skipFor(page: number): number {
  return (Math.max(1, Math.floor(page)) - 1) * PAGE_SIZE;
}

function firstDirection(sort?: Record<string, SortOrder>): 1 | -1 {
  const first = sort ? Object.values(sort)[0] : undefined;
  return first === -1 || first === 'desc' || first === 'descending' ? -1 : 1;
}

export interface PaginateOptions {
  /** Always give a deterministic sort; `_id` is appended as a tie-breaker so pages never overlap. */
  sort?: Record<string, SortOrder>;
  projection?: Record<string, 0 | 1> | string;
}

/**
 * Runs the page query and the count in parallel and returns the GEN-05 envelope:
 *   return paginate(this.postModel, { status: 'PUBLISHED' }, query.page, { sort: { createdAt: -1 } });
 */
export async function paginate<T>(
  model: Model<T>,
  filter: FilterQuery<T>,
  page: number,
  options: PaginateOptions = {},
): Promise<Page<T>> {
  const sort = {
    ...(options.sort ?? {}),
    // Tie-break in the direction of the primary sort key so equal keys keep a stable order.
    _id: options.sort?._id ?? firstDirection(options.sort),
  } as Record<string, SortOrder>;
  const [items, total] = await Promise.all([
    model
      .find(filter, options.projection)
      .sort(sort)
      .skip(skipFor(page))
      .limit(PAGE_SIZE)
      .lean<T[]>()
      .exec(),
    model.countDocuments(filter).exec(),
  ]);
  return toPage(items, total, page);
}

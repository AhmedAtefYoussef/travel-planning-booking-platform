import { Type } from 'class-transformer';
import { Equals, IsInt, IsOptional, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 10;

/** `?page=N` (1-based). Page size is fixed at 10 unless a module overrides. */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  /** Fixed at 10: any other client-sent `limit` is rejected. */
  @IsOptional()
  @Type(() => Number)
  @Equals(DEFAULT_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Documents to skip for a given page (for Mongoose `.skip()`). */
export function pageOffset(page: number, limit = DEFAULT_PAGE_SIZE): number {
  return (Math.max(1, Math.floor(page)) - 1) * limit;
}

export function paginate<T>(
  items: T[],
  total: number,
  page: number,
  limit = DEFAULT_PAGE_SIZE,
): PaginatedResponse<T> {
  return {
    items,
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

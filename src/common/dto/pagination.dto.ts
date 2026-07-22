import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Cursor-based pagination for large datasets.
 * `cursor` is an opaque id of the last item from the previous page.
 * `limit` bounds the page size.
 */
export class CursorPaginationDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 25;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    count: number;
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

/**
 * Build a cursor-paginated result. Caller should fetch `limit + 1` rows so we
 * can detect whether another page exists without a second count query.
 */
export function buildCursorPage<T extends { id: string }>(
  rows: T[],
  limit: number,
): PaginatedResult<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return {
    data,
    meta: {
      count: data.length,
      limit,
      nextCursor: hasMore ? data[data.length - 1].id : null,
      hasMore,
    },
  };
}

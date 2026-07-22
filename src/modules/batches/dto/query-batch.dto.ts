import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class QueryBatchDto {
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsString() warehouseId?: string;

  // Only batches expiring within this many days from now are returned.
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) expiringWithinDays?: number;

  // By default depleted batches (quantityRemaining <= 0) are excluded.
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  @IsBoolean()
  includeEmpty?: boolean;

  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit = 25;
}

import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { MovementType, ValuationMethod } from '@prisma/client';

/**
 * Report type discriminator for the Excel export endpoint.
 */
export type ExportReportType =
  | 'stock-valuation'
  | 'movement-summary'
  | 'low-stock'
  | 'expiring-batches';

export const EXPORT_REPORT_TYPES: ExportReportType[] = [
  'stock-valuation',
  'movement-summary',
  'low-stock',
  'expiring-batches',
];

export class StockValuationQueryDto {
  @IsOptional() @IsString() warehouseId?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsEnum(ValuationMethod) method?: ValuationMethod;
}

export class MovementSummaryQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() warehouseId?: string;
  @IsOptional() @IsEnum(MovementType) type?: MovementType;
  @IsOptional() @IsString() variantId?: string;
}

export class ExpiringBatchesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days = 30;
}

/**
 * Query for the Excel export endpoint. `type` selects the dataset; the
 * remaining fields are the union of the individual report filters and are
 * applied only when relevant to the chosen type.
 */
export class ExportQueryDto {
  @IsIn(EXPORT_REPORT_TYPES)
  type!: ExportReportType;

  // stock-valuation
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsEnum(ValuationMethod) method?: ValuationMethod;

  // movement-summary
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsEnum(MovementType) movementType?: MovementType;
  @IsOptional() @IsString() variantId?: string;

  // shared
  @IsOptional() @IsString() warehouseId?: string;

  // expiring-batches
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days?: number;
}

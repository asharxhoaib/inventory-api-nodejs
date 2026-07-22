import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { UnitOfMeasure, ValuationMethod } from '@prisma/client';

export class CreateProductDto {
  @IsString() name!: string;

  // Optional — auto-generated (PRD-XXXXX) when omitted.
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() categoryId?: string;

  @IsOptional() @IsEnum(UnitOfMeasure) unitOfMeasure?: UnitOfMeasure;

  @IsOptional() @Type(() => Number) @IsNumber() weight?: number;

  // Free-form dimensions, e.g. { length, width, height, unit }.
  @IsOptional() @IsObject() dimensions?: Record<string, unknown>;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) reorderPoint?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) reorderQuantity?: number;

  @IsOptional() @IsEnum(ValuationMethod) valuationMethod?: ValuationMethod;
}

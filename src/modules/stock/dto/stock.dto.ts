import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';
import { ReferenceType } from '@prisma/client';

export class ReceiveStockDto {
  @IsString() variantId!: string;
  @IsString() warehouseId!: string;
  @IsInt() @IsPositive() quantity!: number;

  @IsOptional() @Type(() => Number) unitCost?: number;
  @IsOptional() @IsEnum(ReferenceType) referenceType?: ReferenceType;
  @IsOptional() @IsString() referenceId?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() createdBy?: string;

  // Optional batch details — presence assigns/updates a batch.
  @IsOptional() @IsString() batchNumber?: string;
  @IsOptional() @IsDateString() manufactureDate?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
}

export class DispatchStockDto {
  @IsString() variantId!: string;
  @IsString() warehouseId!: string;
  @IsInt() @IsPositive() quantity!: number;

  @IsOptional() @IsEnum(ReferenceType) referenceType?: ReferenceType;
  @IsOptional() @IsString() referenceId?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() createdBy?: string;
  // When true, allocate from batches FEFO and decrement them.
  @IsOptional() @IsBoolean() useFefo?: boolean;
}

export class TransferStockDto {
  @IsString() variantId!: string;
  @IsString() sourceWarehouseId!: string;
  @IsString() destinationWarehouseId!: string;
  @IsInt() @IsPositive() quantity!: number;

  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() createdBy?: string;
}

export class AdjustStockDto {
  @IsString() variantId!: string;
  @IsString() warehouseId!: string;
  // Signed delta: +5 found extra, -3 shrinkage. Non-zero.
  @IsInt() delta!: number;

  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() createdBy?: string;
  @IsOptional() @IsString() referenceId?: string;
  @IsOptional() @IsEnum(ReferenceType) referenceType?: ReferenceType;
}

export class ReserveStockDto {
  @IsString() variantId!: string;
  @IsString() warehouseId!: string;
  @IsInt() @IsPositive() quantity!: number;

  @IsOptional() @IsString() referenceId?: string;
  @IsOptional() @IsString() createdBy?: string;
}

export class ReleaseReservationDto {
  @IsString() reservationId!: string;
  @IsOptional() @IsString() createdBy?: string;
}

export class FulfillReservationDto {
  @IsString() reservationId!: string;
  @IsOptional() @IsString() createdBy?: string;
}

export class StockLevelQueryDto {
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() warehouseId?: string;
  @IsOptional() @IsBoolean() @Type(() => Boolean) belowReorderPoint?: boolean;
  @IsOptional() @IsBoolean() @Type(() => Boolean) zeroStock?: boolean;
}

export class MovementQueryDto {
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsString() warehouseId?: string;
  @IsOptional() @IsEnum(ReferenceType) referenceType?: ReferenceType;
  @IsOptional() @IsString() referenceId?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit = 25;
}

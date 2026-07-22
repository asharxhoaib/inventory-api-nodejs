import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreatePoItemDto {
  @IsString() variantId!: string;
  @IsInt() @IsPositive() orderedQuantity!: number;
  @Type(() => Number) @IsNumber() @Min(0) unitPrice!: number;
}

export class CreatePoDto {
  @IsString() supplierId!: string;
  @IsString() warehouseId!: string;

  @IsOptional() @IsDateString() expectedDelivery?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() createdBy?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePoItemDto)
  items!: CreatePoItemDto[];
}

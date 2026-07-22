import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class StockTakeCountDto {
  @IsString() variantId!: string;
  @IsInt() @Min(0) actualQuantity!: number;
  @IsOptional() @IsString() notes?: string;
}

export class RecordCountsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockTakeCountDto)
  counts!: StockTakeCountDto[];
}

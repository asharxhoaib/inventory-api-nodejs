import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ReceivePoItemDto {
  @IsString() poItemId!: string;
  @IsInt() @IsPositive() receivedQuantity!: number;
}

export class ReceivePoDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceivePoItemDto)
  items!: ReceivePoItemDto[];

  // Optional override of the PO's default warehouse for this receipt.
  @IsOptional() @IsString() warehouseId?: string;
  @IsOptional() @IsString() createdBy?: string;
}

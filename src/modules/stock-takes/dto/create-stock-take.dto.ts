import { IsOptional, IsString } from 'class-validator';

export class CreateStockTakeDto {
  @IsString() warehouseId!: string;
  @IsOptional() @IsString() createdBy?: string;
}

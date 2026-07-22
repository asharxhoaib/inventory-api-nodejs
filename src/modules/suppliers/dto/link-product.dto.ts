import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsNumber, IsString, Min } from 'class-validator';

export class LinkProductDto {
  @IsString() productId!: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) priority = 1;
  @IsOptional() @IsString() supplierSku?: string;
  @IsOptional() @Type(() => Number) @IsNumber() unitPrice?: number;
}

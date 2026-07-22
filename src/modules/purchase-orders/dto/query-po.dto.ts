import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PurchaseOrderStatus } from '@prisma/client';

export class QueryPoDto {
  @IsOptional() @IsEnum(PurchaseOrderStatus) status?: PurchaseOrderStatus;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit = 25;
}

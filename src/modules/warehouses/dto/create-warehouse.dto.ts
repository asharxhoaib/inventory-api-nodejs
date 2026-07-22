import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateWarehouseDto {
  @IsString() name!: string;
  @IsString() code!: string;

  @IsOptional() @IsObject() address?: Record<string, unknown>;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) capacity?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

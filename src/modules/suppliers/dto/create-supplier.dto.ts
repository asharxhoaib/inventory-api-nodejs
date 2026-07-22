import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PaymentTerms } from '@prisma/client';

export class CreateSupplierDto {
  @IsString() name!: string;
  @IsString() code!: string;

  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;

  // Free-form address, e.g. { line1, city, country, postalCode }.
  @IsOptional() @IsObject() address?: Record<string, unknown>;

  @IsOptional() @IsEnum(PaymentTerms) paymentTerms?: PaymentTerms;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) leadTimeDays?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

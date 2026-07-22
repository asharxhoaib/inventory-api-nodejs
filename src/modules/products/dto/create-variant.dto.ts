import { IsObject, IsOptional, IsString } from 'class-validator';

export class CreateVariantDto {
  @IsString() name!: string;

  // Optional — derived from the parent SKU + attributes when omitted.
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() barcode?: string;

  // Variant attributes, e.g. { color: 'Red', size: 'L' }.
  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
}

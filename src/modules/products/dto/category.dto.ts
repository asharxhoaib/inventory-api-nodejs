import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateCategoryDto {
  @IsString() name!: string;

  // Optional parent — omit for a root category.
  @IsOptional() @IsString() parentId?: string;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}

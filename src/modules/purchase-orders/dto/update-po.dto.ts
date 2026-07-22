import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CreatePoItemDto } from './create-po.dto';

/**
 * Only editable while the PO is DRAFT (enforced in the service).
 * When `items` is supplied it replaces the existing lines and the total is
 * recomputed; omit it to leave the lines untouched.
 */
export class UpdatePoDto {
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsDateString() expectedDelivery?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePoItemDto)
  items?: CreatePoItemDto[];
}

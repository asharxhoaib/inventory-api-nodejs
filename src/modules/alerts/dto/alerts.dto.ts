import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AlertStatus, AlertType } from '@prisma/client';

export class AlertQueryDto {
  @IsOptional() @IsEnum(AlertStatus) status?: AlertStatus;
  @IsOptional() @IsEnum(AlertType) type?: AlertType;
  @IsOptional() @IsString() warehouseId?: string;
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WarehousesService } from './warehouses.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';

@ApiTags('warehouses')
@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Post()
  create(@Body() dto: CreateWarehouseDto) {
    return this.warehouses.create(dto);
  }

  @Get()
  findAll(@Query('isActive') isActive?: string) {
    const flag =
      isActive === undefined ? undefined : isActive === 'true';
    return this.warehouses.findAll(flag);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.warehouses.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWarehouseDto) {
    return this.warehouses.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.warehouses.remove(id);
  }
}

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
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { LinkProductDto } from './dto/link-product.dto';

@ApiTags('suppliers')
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Post()
  create(@Body() dto: CreateSupplierDto) {
    return this.suppliers.create(dto);
  }

  @Get()
  list(@Query('isActive') isActive?: string) {
    const flag =
      isActive === undefined ? undefined : isActive === 'true';
    return this.suppliers.findAll(flag);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.suppliers.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.suppliers.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.suppliers.remove(id);
  }

  @Post(':id/products')
  linkProduct(@Param('id') id: string, @Body() dto: LinkProductDto) {
    return this.suppliers.linkProduct(id, dto);
  }

  @Delete(':id/products/:productId')
  unlinkProduct(
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.suppliers.unlinkProduct(id, productId);
  }

  @Get(':id/performance')
  getPerformance(@Param('id') id: string) {
    return this.suppliers.getPerformance(id);
  }
}

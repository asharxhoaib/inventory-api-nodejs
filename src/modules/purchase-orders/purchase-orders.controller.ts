import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePoDto } from './dto/create-po.dto';
import { UpdatePoDto } from './dto/update-po.dto';
import { ReceivePoDto } from './dto/receive-po.dto';
import { QueryPoDto } from './dto/query-po.dto';

@ApiTags('purchase-orders')
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrders: PurchaseOrdersService) {}

  @Post()
  create(@Body() dto: CreatePoDto) {
    return this.purchaseOrders.create(dto);
  }

  @Get()
  list(@Query() query: QueryPoDto) {
    return this.purchaseOrders.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.purchaseOrders.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePoDto) {
    return this.purchaseOrders.update(id, dto);
  }

  @Post(':id/submit')
  submit(@Param('id') id: string) {
    return this.purchaseOrders.submit(id);
  }

  @Post(':id/receive')
  receive(@Param('id') id: string, @Body() dto: ReceivePoDto) {
    return this.purchaseOrders.receive(id, dto);
  }

  @Put(':id/close')
  close(@Param('id') id: string) {
    return this.purchaseOrders.close(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.purchaseOrders.cancel(id);
  }
}

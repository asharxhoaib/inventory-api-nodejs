import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BatchesService } from './batches.service';
import { QueryBatchDto } from './dto/query-batch.dto';

@ApiTags('batches')
@Controller('batches')
export class BatchesController {
  constructor(private readonly batches: BatchesService) {}

  @Get()
  findAll(@Query() query: QueryBatchDto) {
    return this.batches.findAll(query);
  }

  @Get('fefo/suggest')
  getFefoSuggestion(
    @Query('variantId') variantId: string,
    @Query('warehouseId') warehouseId: string,
    @Query('quantity') quantity: string,
  ) {
    return this.batches.getFefoSuggestion(
      variantId,
      warehouseId,
      Number(quantity),
    );
  }

  @Get('expiring')
  getExpiring(@Query('days') days?: string) {
    return this.batches.getExpiring(days === undefined ? 30 : Number(days));
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.batches.findOne(id);
  }
}

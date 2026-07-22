import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { StockTakesService } from './stock-takes.service';
import { CreateStockTakeDto } from './dto/create-stock-take.dto';
import { RecordCountsDto } from './dto/record-counts.dto';

@ApiTags('stock-takes')
@Controller('stock-takes')
export class StockTakesController {
  constructor(private readonly stockTakes: StockTakesService) {}

  @Post()
  create(@Body() dto: CreateStockTakeDto) {
    return this.stockTakes.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.stockTakes.findOne(id);
  }

  @Put(':id/count')
  recordCounts(@Param('id') id: string, @Body() dto: RecordCountsDto) {
    return this.stockTakes.recordCounts(id, dto);
  }

  @Post(':id/complete')
  complete(
    @Param('id') id: string,
    @Body('createdBy') createdBy?: string,
  ) {
    return this.stockTakes.complete(id, createdBy);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.stockTakes.cancel(id);
  }
}

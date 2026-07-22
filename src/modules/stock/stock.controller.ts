import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { StockService } from './stock.service';
import {
  AdjustStockDto,
  DispatchStockDto,
  FulfillReservationDto,
  MovementQueryDto,
  ReceiveStockDto,
  ReleaseReservationDto,
  ReserveStockDto,
  StockLevelQueryDto,
  TransferStockDto,
} from './dto/stock.dto';

@ApiTags('stock')
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  getStockLevels(@Query() query: StockLevelQueryDto) {
    return this.stock.getStockLevels(query);
  }

  @Get('level/:variantId/:warehouseId')
  getStockLevel(
    @Param('variantId') variantId: string,
    @Param('warehouseId') warehouseId: string,
  ) {
    return this.stock.getStockLevel(variantId, warehouseId);
  }

  @Get('movements')
  listMovements(@Query() query: MovementQueryDto) {
    return this.stock.listMovements(query);
  }

  @Post('receive')
  receive(@Body() dto: ReceiveStockDto) {
    return this.stock.receive(dto);
  }

  @Post('dispatch')
  dispatch(@Body() dto: DispatchStockDto) {
    return this.stock.dispatch(dto);
  }

  @Post('transfer')
  transfer(@Body() dto: TransferStockDto) {
    return this.stock.transfer(dto);
  }

  @Post('adjust')
  adjust(@Body() dto: AdjustStockDto) {
    return this.stock.adjust(dto);
  }

  @Post('reserve')
  reserve(@Body() dto: ReserveStockDto) {
    return this.stock.reserve(dto);
  }

  @Post('release')
  release(@Body() dto: ReleaseReservationDto) {
    return this.stock.releaseReservation(dto);
  }

  @Post('fulfill')
  fulfill(@Body() dto: FulfillReservationDto) {
    return this.stock.fulfillReservation(dto);
  }
}

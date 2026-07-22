import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { StockTakesController } from './stock-takes.controller';
import { StockTakesService } from './stock-takes.service';

@Module({
  imports: [StockModule],
  controllers: [StockTakesController],
  providers: [StockTakesService],
  exports: [StockTakesService],
})
export class StockTakesModule {}

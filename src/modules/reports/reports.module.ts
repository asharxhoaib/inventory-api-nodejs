import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ValuationService } from './valuation.service';
import { ExcelService } from './excel.service';

@Module({
  imports: [StockModule],
  controllers: [ReportsController],
  providers: [ReportsService, ValuationService, ExcelService],
  exports: [ReportsService, ValuationService],
})
export class ReportsModule {}

import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { ExcelService } from './excel.service';
import {
  ExpiringBatchesQueryDto,
  ExportQueryDto,
  MovementSummaryQueryDto,
  StockValuationQueryDto,
} from './dto/report-query.dto';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly excel: ExcelService,
  ) {}

  @Get('stock-valuation')
  stockValuation(@Query() query: StockValuationQueryDto) {
    return this.reports.stockValuation(query);
  }

  @Get('movement-summary')
  movementSummary(@Query() query: MovementSummaryQueryDto) {
    return this.reports.movementSummary(query);
  }

  @Get('low-stock')
  lowStock() {
    return this.reports.lowStock();
  }

  @Get('expiring-batches')
  expiringBatches(@Query() query: ExpiringBatchesQueryDto) {
    return this.reports.expiringBatches(query.days);
  }

  @Get('export')
  async export(
    @Query() query: ExportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.excel.exportReport(query.type, {
      warehouseId: query.warehouseId,
      categoryId: query.categoryId,
      method: query.method,
      from: query.from,
      to: query.to,
      movementType: query.movementType,
      variantId: query.variantId,
      days: query.days,
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.end(buffer);
  }
}

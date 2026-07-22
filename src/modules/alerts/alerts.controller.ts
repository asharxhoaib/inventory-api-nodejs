import { Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AlertsService } from './alerts.service';
import { AlertQueryDto } from './dto/alerts.dto';

@ApiTags('alerts')
@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  list(@Query() query: AlertQueryDto) {
    // With a status filter, honour it; otherwise default to the active list.
    if (query.status) {
      return this.alerts.findAll(query);
    }
    return this.alerts.findActive({
      type: query.type,
      warehouseId: query.warehouseId,
    });
  }

  @Put(':id/acknowledge')
  acknowledge(@Param('id') id: string) {
    return this.alerts.acknowledge(id);
  }

  @Put(':id/resolve')
  resolve(@Param('id') id: string) {
    return this.alerts.resolve(id);
  }

  @Post('scan/low-stock')
  scanLowStock() {
    return this.alerts.runLowStockScan();
  }

  @Post('scan/expiry')
  scanExpiry() {
    const thresholdDays = this.config.get<number>(
      'business.expiryAlertThresholdDays',
    );
    return this.alerts.runExpiryScan(thresholdDays ?? 30);
  }
}

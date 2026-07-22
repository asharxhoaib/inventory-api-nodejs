import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { QueueModule } from '../../queue/queue.module';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertsGateway } from './alerts.gateway';
import { AlertsProcessor } from './processors/alerts.processor';

@Module({
  imports: [StockModule, QueueModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertsGateway, AlertsProcessor],
  exports: [AlertsService, AlertsProcessor],
})
export class AlertsModule {}

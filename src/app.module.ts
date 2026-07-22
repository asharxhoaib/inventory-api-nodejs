import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './queue/queue.module';
import { StockModule } from './modules/stock/stock.module';
import { ProductsModule } from './modules/products/products.module';
import { WarehousesModule } from './modules/warehouses/warehouses.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { PurchaseOrdersModule } from './modules/purchase-orders/purchase-orders.module';
import { BatchesModule } from './modules/batches/batches.module';
import { StockTakesModule } from './modules/stock-takes/stock-takes.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { ReportsModule } from './modules/reports/reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    PrismaModule,
    RedisModule,
    QueueModule,
    StockModule,
    ProductsModule,
    WarehousesModule,
    SuppliersModule,
    PurchaseOrdersModule,
    BatchesModule,
    StockTakesModule,
    AlertsModule,
    ReportsModule,
  ],
})
export class AppModule {}

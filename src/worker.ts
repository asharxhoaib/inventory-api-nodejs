import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import { AppModule } from './app.module';
import { QUEUE_NAMES } from './config/queue.constants';
import { AlertsProcessor } from './modules/alerts/processors/alerts.processor';

/**
 * Standalone BullMQ worker process. Boots a Nest application context (no HTTP
 * server) purely to resolve the DI container, then attaches a BullMQ Worker to
 * the alerts queue that delegates each job to AlertsProcessor.
 *
 * Run with: `npm run worker` (built) or `npm run worker:dev`.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Worker');
  const app = await NestFactory.createApplicationContext(AppModule);
  const config = app.get(ConfigService);
  const processor = app.get(AlertsProcessor);

  const connection = {
    host: config.get<string>('redis.host'),
    port: config.get<number>('redis.port'),
    password: config.get<string>('redis.password'),
  };

  const worker = new Worker(
    QUEUE_NAMES.ALERTS,
    async (job: Job) => processor.process(job),
    { connection },
  );

  worker.on('completed', (job) =>
    logger.log(`Job ${job.id} (${job.name}) completed`),
  );
  worker.on('failed', (job, err) =>
    logger.error(`Job ${job?.id} (${job?.name}) failed: ${err.message}`),
  );

  logger.log(`Worker listening on queue "${QUEUE_NAMES.ALERTS}"`);

  const shutdown = async (): Promise<void> => {
    logger.log('Shutting down worker...');
    await worker.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void bootstrap();

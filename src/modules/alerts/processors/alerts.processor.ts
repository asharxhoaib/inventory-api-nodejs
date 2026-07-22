import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Processor, Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { JOB_NAMES } from '../../../config/queue.constants';
import { AlertsService } from '../alerts.service';

/**
 * Dispatches BullMQ alert jobs to the AlertsService. This class does NOT
 * instantiate a Worker — the standalone worker.ts entrypoint owns the process
 * lifecycle and wires a Worker around `process`. That keeps the Nest app (which
 * enqueues + serves HTTP/WS) separate from the worker process (which consumes).
 */
@Injectable()
export class AlertsProcessor {
  private readonly logger = new Logger(AlertsProcessor.name);

  constructor(
    private readonly alerts: AlertsService,
    private readonly config: ConfigService,
  ) {}

  process = async (job: Job): Promise<unknown> => {
    this.logger.log(`Processing job ${job.name} (${job.id})`);

    switch (job.name) {
      case JOB_NAMES.LOW_STOCK_SCAN:
        return this.alerts.runLowStockScan();

      case JOB_NAMES.EXPIRY_SCAN: {
        const thresholdDays =
          this.config.get<number>('business.expiryAlertThresholdDays') ?? 30;
        return this.alerts.runExpiryScan(thresholdDays);
      }

      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        return undefined;
    }
  };
}

/**
 * Convenience factory the worker.ts entrypoint can use to spin up a BullMQ
 * Worker bound to a processor's `process` method. `connection` accepts an
 * ioredis instance or a plain connection option object — BullMQ handles both.
 */
export function createAlertsWorker(
  queueName: string,
  connection: ConnectionOptions,
  processorFn: Processor,
): Worker {
  return new Worker(queueName, processorFn, { connection });
}

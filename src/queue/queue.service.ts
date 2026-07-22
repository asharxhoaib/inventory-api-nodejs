import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import {
  JOB_NAMES,
  QUEUE_NAMES,
  REPEATABLE_JOB_IDS,
} from '../config/queue.constants';

/**
 * Owns the shared BullMQ queues. The ioredis client from RedisModule is reused
 * directly as the BullMQ connection — BullMQ accepts an ioredis instance — so
 * there is a single Redis connection pool for the whole process.
 *
 * On boot it registers the two repeatable scan jobs from the cron expressions
 * in config. The stable jobIds keep BullMQ from stacking a fresh schedule on
 * every restart.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly alertsQueue: Queue;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.alertsQueue = new Queue(QUEUE_NAMES.ALERTS, {
      connection: this.redis,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.registerRepeatableJobs();
  }

  async onModuleDestroy(): Promise<void> {
    await this.alertsQueue.close();
  }

  getAlertsQueue(): Queue {
    return this.alertsQueue;
  }

  /**
   * Add (idempotently) the two repeatable scan jobs. BullMQ dedupes repeatable
   * jobs by the combination of name, pattern and jobId, so calling this on every
   * boot is safe.
   */
  async registerRepeatableJobs(): Promise<void> {
    const lowStockCron =
      this.config.get<string>('business.lowStockCron') ?? '0 * * * *';
    const expiryCron =
      this.config.get<string>('business.expiryCron') ?? '0 6 * * *';

    await this.alertsQueue.add(
      JOB_NAMES.LOW_STOCK_SCAN,
      {},
      {
        repeat: { pattern: lowStockCron },
        jobId: REPEATABLE_JOB_IDS.LOW_STOCK,
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );

    await this.alertsQueue.add(
      JOB_NAMES.EXPIRY_SCAN,
      {},
      {
        repeat: { pattern: expiryCron },
        jobId: REPEATABLE_JOB_IDS.EXPIRY,
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );

    this.logger.log(
      `Registered repeatable jobs: ${JOB_NAMES.LOW_STOCK_SCAN} (${lowStockCron}), ${JOB_NAMES.EXPIRY_SCAN} (${expiryCron})`,
    );
  }
}

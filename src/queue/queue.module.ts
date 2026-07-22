import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';

/**
 * Shared queue infrastructure. RedisModule is @Global so the REDIS_CLIENT token
 * is available here without an explicit import.
 */
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Batch, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { QueryBatchDto } from './dto/query-batch.dto';

@Injectable()
export class BatchesService {
  private readonly logger = new Logger(BatchesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  /**
   * List batches with optional filters. Depleted batches
   * (quantityRemaining <= 0) are excluded unless `includeEmpty` is set.
   * `expiringWithinDays` keeps only batches whose expiry falls on or before
   * now + N days.
   */
  async findAll(query: QueryBatchDto): Promise<Batch[]> {
    const where: Prisma.BatchWhereInput = {};
    if (query.variantId) where.variantId = query.variantId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;

    if (!query.includeEmpty) {
      where.quantityRemaining = { gt: 0 };
    }

    if (query.expiringWithinDays !== undefined) {
      const cutoff = new Date(
        Date.now() + query.expiringWithinDays * 24 * 60 * 60 * 1000,
      );
      where.expiryDate = { lte: cutoff };
    }

    return this.prisma.batch.findMany({
      where,
      orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Fetch a single batch by id. */
  async findOne(id: string): Promise<Batch> {
    const batch = await this.prisma.batch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException(`Batch ${id} not found`);
    return batch;
  }

  /**
   * FEFO allocation suggestion for a variant/warehouse pair. Delegates to the
   * StockService so batch-picking logic lives in one place.
   */
  async getFefoSuggestion(
    variantId: string,
    warehouseId: string,
    quantity: number,
  ): Promise<{ batch: Batch; take: number }[]> {
    return this.stock.suggestFefoBatches(
      this.prisma,
      variantId,
      warehouseId,
      quantity,
    );
  }

  /**
   * Batches with stock remaining that expire within the next N days, ordered
   * by expiry ascending (soonest first).
   */
  async getExpiring(days: number): Promise<Batch[]> {
    const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return this.prisma.batch.findMany({
      where: {
        quantityRemaining: { gt: 0 },
        expiryDate: { lte: cutoff },
      },
      orderBy: { expiryDate: 'asc' },
    });
  }
}

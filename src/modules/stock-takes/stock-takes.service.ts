import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  MovementType,
  ReferenceType,
  StockTake,
  StockTakeStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { CreateStockTakeDto } from './dto/create-stock-take.dto';
import { RecordCountsDto } from './dto/record-counts.dto';

@Injectable()
export class StockTakesService {
  private readonly logger = new Logger(StockTakesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  /**
   * Open a stock take for a warehouse. Only one may be IN_PROGRESS per
   * warehouse at a time — a second open request is rejected. Every variant
   * with a movement in the warehouse is snapshotted as a StockTakeItem whose
   * expectedQuantity is the current physical stock (SUM of movement quantity).
   */
  async create(dto: CreateStockTakeDto): Promise<StockTake> {
    const active = await this.prisma.stockTake.findFirst({
      where: {
        warehouseId: dto.warehouseId,
        status: StockTakeStatus.IN_PROGRESS,
      },
      select: { id: true },
    });
    if (active) {
      throw new ConflictException(
        `Warehouse ${dto.warehouseId} already has an in-progress stock take (${active.id})`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const stockTake = await tx.stockTake.create({
        data: {
          warehouseId: dto.warehouseId,
          status: StockTakeStatus.IN_PROGRESS,
          createdBy: dto.createdBy,
        },
      });

      // One groupBy gives the physical stock of every variant in the
      // warehouse — the expected count each item is measured against.
      const stockRows = await tx.stockMovement.groupBy({
        by: ['variantId'],
        where: { warehouseId: dto.warehouseId },
        _sum: { quantity: true },
      });

      if (stockRows.length > 0) {
        await tx.stockTakeItem.createMany({
          data: stockRows.map((row) => ({
            stockTakeId: stockTake.id,
            variantId: row.variantId,
            expectedQuantity: row._sum.quantity ?? 0,
          })),
        });
      }

      this.logger.log(
        `Opened stock take ${stockTake.id} for warehouse ${dto.warehouseId} with ${stockRows.length} item(s)`,
      );
      return stockTake;
    });
  }

  /** Fetch a stock take with its items (and each item's variant sku/name). */
  async findOne(id: string): Promise<StockTake> {
    const stockTake = await this.prisma.stockTake.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            variant: { select: { sku: true, name: true } },
          },
        },
      },
    });
    if (!stockTake) throw new NotFoundException(`Stock take ${id} not found`);
    return stockTake;
  }

  /**
   * Record counted quantities against an in-progress stock take. Each count is
   * upserted by variant; difference is actualQuantity - expectedQuantity. A
   * count for a variant not seen at open time is created with an expected of 0.
   */
  async recordCounts(id: string, dto: RecordCountsDto): Promise<StockTake> {
    const stockTake = await this.prisma.stockTake.findUnique({
      where: { id },
      include: { items: { select: { variantId: true, expectedQuantity: true } } },
    });
    if (!stockTake) throw new NotFoundException(`Stock take ${id} not found`);
    if (stockTake.status !== StockTakeStatus.IN_PROGRESS) {
      throw new BadRequestException(
        `Stock take ${id} is ${stockTake.status}, cannot record counts`,
      );
    }

    const expectedByVariant = new Map(
      stockTake.items.map((item) => [item.variantId, item.expectedQuantity]),
    );

    await this.prisma.$transaction(
      dto.counts.map((count) => {
        const expected = expectedByVariant.get(count.variantId) ?? 0;
        const difference = count.actualQuantity - expected;
        return this.prisma.stockTakeItem.upsert({
          where: {
            stockTakeId_variantId: {
              stockTakeId: id,
              variantId: count.variantId,
            },
          },
          create: {
            stockTakeId: id,
            variantId: count.variantId,
            expectedQuantity: expected,
            actualQuantity: count.actualQuantity,
            difference,
            notes: count.notes,
          },
          update: {
            actualQuantity: count.actualQuantity,
            difference,
            notes: count.notes,
          },
        });
      }),
    );

    return this.findOne(id);
  }

  /**
   * Complete a stock take, posting an ADJUSTMENT movement for every counted
   * item whose difference is non-zero.
   *
   * Ordering matters: StockService.assertNotLockedByStockTake rejects any
   * movement against a warehouse with an IN_PROGRESS stock take. So we flip
   * the status to COMPLETED FIRST, then post the adjustments — all inside one
   * transaction, so either the whole reconciliation lands or none of it does.
   */
  async complete(id: string, createdBy?: string): Promise<StockTake> {
    const stockTake = await this.prisma.stockTake.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!stockTake) throw new NotFoundException(`Stock take ${id} not found`);
    if (stockTake.status !== StockTakeStatus.IN_PROGRESS) {
      throw new BadRequestException(
        `Stock take ${id} is ${stockTake.status}, cannot complete`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Flip status first so the warehouse is no longer "locked" and the
      // adjustment movements below are accepted.
      const completed = await tx.stockTake.update({
        where: { id },
        data: {
          status: StockTakeStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      for (const item of stockTake.items) {
        if (item.actualQuantity === null || item.difference === null) continue;
        if (item.difference === 0) continue;

        await this.stock.recordMovementRaw(tx, {
          variantId: item.variantId,
          warehouseId: stockTake.warehouseId,
          type: MovementType.ADJUSTMENT,
          // ADJUSTMENT passes the raw signed delta straight through.
          signedQty: item.difference,
          referenceType: ReferenceType.STOCK_TAKE,
          referenceId: stockTake.id,
          reason: 'Stock take adjustment',
          createdBy: createdBy ?? stockTake.createdBy ?? undefined,
        });
      }

      this.logger.log(`Completed stock take ${id}`);
      return completed;
    });
  }

  /** Cancel an in-progress stock take. No adjustments are posted. */
  async cancel(id: string): Promise<StockTake> {
    const stockTake = await this.prisma.stockTake.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!stockTake) throw new NotFoundException(`Stock take ${id} not found`);
    if (stockTake.status !== StockTakeStatus.IN_PROGRESS) {
      throw new BadRequestException(
        `Stock take ${id} is ${stockTake.status}, cannot cancel`,
      );
    }

    this.logger.log(`Canceling stock take ${id}`);
    return this.prisma.stockTake.update({
      where: { id },
      data: { status: StockTakeStatus.CANCELED },
    });
  }
}

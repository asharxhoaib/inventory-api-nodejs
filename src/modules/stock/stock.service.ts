import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Batch,
  MovementType,
  Prisma,
  ReferenceType,
  ReservationStatus,
  StockMovement,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AdjustStockDto,
  DispatchStockDto,
  FulfillReservationDto,
  MovementQueryDto,
  ReceiveStockDto,
  ReleaseReservationDto,
  ReserveStockDto,
  StockLevelQueryDto,
  TransferStockDto,
} from './dto/stock.dto';
import { signedQuantity } from './stock.constants';

export type PrismaTx = Prisma.TransactionClient;

export interface StockLevel {
  variantId: string;
  warehouseId: string;
  physical: number;
  reserved: number;
  available: number;
}

/**
 * The single gateway for all stock changes.
 *
 * Invariants enforced here:
 *  - Physical stock is never stored; it is SUM(StockMovement.quantity).
 *  - Reserved stock is SUM(Reservation.quantity) where status = ACTIVE.
 *  - Available stock = physical - reserved and may never go negative on a
 *    dispatch or reservation (overselling guard).
 *  - Movements for a warehouse with an IN_PROGRESS stock take are rejected.
 */
@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Aggregations ────────────────────────────────────────────

  async physicalStock(
    client: PrismaTx | PrismaService,
    variantId: string,
    warehouseId: string,
  ): Promise<number> {
    const agg = await client.stockMovement.aggregate({
      where: { variantId, warehouseId },
      _sum: { quantity: true },
    });
    return agg._sum.quantity ?? 0;
  }

  async reservedStock(
    client: PrismaTx | PrismaService,
    variantId: string,
    warehouseId: string,
  ): Promise<number> {
    const agg = await client.reservation.aggregate({
      where: { variantId, warehouseId, status: ReservationStatus.ACTIVE },
      _sum: { quantity: true },
    });
    return agg._sum.quantity ?? 0;
  }

  async getStockLevel(
    variantId: string,
    warehouseId: string,
  ): Promise<StockLevel> {
    const [physical, reserved] = await Promise.all([
      this.physicalStock(this.prisma, variantId, warehouseId),
      this.reservedStock(this.prisma, variantId, warehouseId),
    ]);
    return {
      variantId,
      warehouseId,
      physical,
      reserved,
      available: physical - reserved,
    };
  }

  /**
   * Aggregate stock levels across variant/warehouse pairs. Uses a single
   * groupBy for physical stock and a second for reservations, then merges.
   */
  async getStockLevels(query: StockLevelQueryDto): Promise<StockLevel[]> {
    const movementWhere: Prisma.StockMovementWhereInput = {};
    const reservationWhere: Prisma.ReservationWhereInput = {
      status: ReservationStatus.ACTIVE,
    };

    if (query.variantId) {
      movementWhere.variantId = query.variantId;
      reservationWhere.variantId = query.variantId;
    }
    if (query.warehouseId) {
      movementWhere.warehouseId = query.warehouseId;
      reservationWhere.warehouseId = query.warehouseId;
    }
    if (query.productId) {
      const variantFilter = { variant: { productId: query.productId } };
      Object.assign(movementWhere, variantFilter);
      Object.assign(reservationWhere, variantFilter);
    }

    const [physicalRows, reservedRows] = await Promise.all([
      this.prisma.stockMovement.groupBy({
        by: ['variantId', 'warehouseId'],
        where: movementWhere,
        _sum: { quantity: true },
      }),
      this.prisma.reservation.groupBy({
        by: ['variantId', 'warehouseId'],
        where: reservationWhere,
        _sum: { quantity: true },
      }),
    ]);

    const reservedMap = new Map<string, number>();
    for (const r of reservedRows) {
      reservedMap.set(
        `${r.variantId}:${r.warehouseId}`,
        r._sum.quantity ?? 0,
      );
    }

    let levels: StockLevel[] = physicalRows.map((row) => {
      const physical = row._sum.quantity ?? 0;
      const reserved =
        reservedMap.get(`${row.variantId}:${row.warehouseId}`) ?? 0;
      return {
        variantId: row.variantId,
        warehouseId: row.warehouseId,
        physical,
        reserved,
        available: physical - reserved,
      };
    });

    if (query.zeroStock) {
      levels = levels.filter((l) => l.physical === 0);
    }

    if (query.belowReorderPoint) {
      const variantIds = levels.map((l) => l.variantId);
      const variants = await this.prisma.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, product: { select: { reorderPoint: true } } },
      });
      const reorderMap = new Map(
        variants.map((v) => [v.id, v.product.reorderPoint]),
      );
      levels = levels.filter(
        (l) => l.physical <= (reorderMap.get(l.variantId) ?? 0),
      );
    }

    return levels;
  }

  // ── Guards ──────────────────────────────────────────────────

  /**
   * Reject movements against a warehouse that has an IN_PROGRESS stock take —
   * counts must be taken against a frozen picture.
   */
  async assertNotLockedByStockTake(
    client: PrismaTx | PrismaService,
    warehouseId: string,
  ): Promise<void> {
    const active = await client.stockTake.findFirst({
      where: { warehouseId, status: 'IN_PROGRESS' },
      select: { id: true },
    });
    if (active) {
      throw new ConflictException(
        `Warehouse ${warehouseId} is locked by an in-progress stock take (${active.id})`,
      );
    }
  }

  // ── Low-level movement writer ───────────────────────────────

  /**
   * Persist a single movement with an already-signed quantity and, when a batch
   * is supplied, keep the batch's remaining quantity in step. Runs against
   * whatever client is passed so it can compose inside a larger transaction.
   */
  async recordMovementRaw(
    client: PrismaTx,
    params: {
      variantId: string;
      warehouseId: string;
      type: MovementType;
      signedQty: number;
      referenceType?: ReferenceType;
      referenceId?: string;
      batchId?: string;
      unitCost?: number;
      reason?: string;
      createdBy?: string;
    },
  ): Promise<StockMovement> {
    const movement = await client.stockMovement.create({
      data: {
        variantId: params.variantId,
        warehouseId: params.warehouseId,
        type: params.type,
        quantity: params.signedQty,
        referenceType: params.referenceType ?? ReferenceType.MANUAL,
        referenceId: params.referenceId,
        batchId: params.batchId,
        unitCost:
          params.unitCost !== undefined
            ? new Prisma.Decimal(params.unitCost)
            : undefined,
        reason: params.reason,
        createdBy: params.createdBy,
      },
    });

    if (params.batchId) {
      await client.batch.update({
        where: { id: params.batchId },
        data: { quantityRemaining: { increment: params.signedQty } },
      });
    }

    return movement;
  }

  // ── High-level operations ───────────────────────────────────

  async receive(dto: ReceiveStockDto): Promise<StockMovement> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertVariantAndWarehouse(tx, dto.variantId, dto.warehouseId);
      await this.assertNotLockedByStockTake(tx, dto.warehouseId);

      let batchId: string | undefined;
      if (dto.batchNumber) {
        const batch = await this.upsertBatch(tx, {
          variantId: dto.variantId,
          warehouseId: dto.warehouseId,
          batchNumber: dto.batchNumber,
          manufactureDate: dto.manufactureDate,
          expiryDate: dto.expiryDate,
        });
        batchId = batch.id;
      }

      return this.recordMovementRaw(tx, {
        variantId: dto.variantId,
        warehouseId: dto.warehouseId,
        type: MovementType.RECEIVE,
        signedQty: signedQuantity(MovementType.RECEIVE, dto.quantity),
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
        batchId,
        unitCost: dto.unitCost,
        reason: dto.reason,
        createdBy: dto.createdBy,
      });
    });
  }

  async dispatch(dto: DispatchStockDto): Promise<StockMovement[]> {
    return this.prisma.$transaction(
      async (tx) => {
        await this.assertVariantAndWarehouse(
          tx,
          dto.variantId,
          dto.warehouseId,
        );
        await this.assertNotLockedByStockTake(tx, dto.warehouseId);

        const [physical, reserved] = await Promise.all([
          this.physicalStock(tx, dto.variantId, dto.warehouseId),
          this.reservedStock(tx, dto.variantId, dto.warehouseId),
        ]);
        const available = physical - reserved;
        if (dto.quantity > available) {
          throw new BadRequestException(
            `Insufficient available stock: requested ${dto.quantity}, available ${available} (physical ${physical}, reserved ${reserved})`,
          );
        }

        if (dto.useFefo) {
          return this.dispatchFefo(tx, dto);
        }

        const movement = await this.recordMovementRaw(tx, {
          variantId: dto.variantId,
          warehouseId: dto.warehouseId,
          type: MovementType.DISPATCH,
          signedQty: signedQuantity(MovementType.DISPATCH, dto.quantity),
          referenceType: dto.referenceType,
          referenceId: dto.referenceId,
          reason: dto.reason,
          createdBy: dto.createdBy,
        });
        return [movement];
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async transfer(dto: TransferStockDto): Promise<StockMovement[]> {
    if (dto.sourceWarehouseId === dto.destinationWarehouseId) {
      throw new BadRequestException(
        'Source and destination warehouses must differ',
      );
    }
    return this.prisma.$transaction(
      async (tx) => {
        await this.assertVariantAndWarehouse(
          tx,
          dto.variantId,
          dto.sourceWarehouseId,
        );
        await this.assertWarehouse(tx, dto.destinationWarehouseId);
        await this.assertNotLockedByStockTake(tx, dto.sourceWarehouseId);
        await this.assertNotLockedByStockTake(tx, dto.destinationWarehouseId);

        const [physical, reserved] = await Promise.all([
          this.physicalStock(tx, dto.variantId, dto.sourceWarehouseId),
          this.reservedStock(tx, dto.variantId, dto.sourceWarehouseId),
        ]);
        const available = physical - reserved;
        if (dto.quantity > available) {
          throw new BadRequestException(
            `Insufficient available stock to transfer: requested ${dto.quantity}, available ${available}`,
          );
        }

        const out = await this.recordMovementRaw(tx, {
          variantId: dto.variantId,
          warehouseId: dto.sourceWarehouseId,
          type: MovementType.TRANSFER_OUT,
          signedQty: signedQuantity(MovementType.TRANSFER_OUT, dto.quantity),
          referenceType: ReferenceType.TRANSFER,
          reason: dto.reason,
          createdBy: dto.createdBy,
        });
        const inbound = await this.recordMovementRaw(tx, {
          variantId: dto.variantId,
          warehouseId: dto.destinationWarehouseId,
          type: MovementType.TRANSFER_IN,
          signedQty: signedQuantity(MovementType.TRANSFER_IN, dto.quantity),
          referenceType: ReferenceType.TRANSFER,
          referenceId: out.id,
          reason: dto.reason,
          createdBy: dto.createdBy,
        });
        return [out, inbound];
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async adjust(dto: AdjustStockDto): Promise<StockMovement> {
    if (dto.delta === 0) {
      throw new BadRequestException('Adjustment delta must be non-zero');
    }
    return this.prisma.$transaction(async (tx) => {
      await this.assertVariantAndWarehouse(tx, dto.variantId, dto.warehouseId);
      // Note: a negative adjustment is allowed to take physical below reserved;
      // that is a legitimate count correction, not an oversell.
      return this.recordMovementRaw(tx, {
        variantId: dto.variantId,
        warehouseId: dto.warehouseId,
        type: MovementType.ADJUSTMENT,
        signedQty: dto.delta,
        referenceType: dto.referenceType ?? ReferenceType.MANUAL,
        referenceId: dto.referenceId,
        reason: dto.reason ?? 'Manual adjustment',
        createdBy: dto.createdBy,
      });
    });
  }

  // ── Reservations ────────────────────────────────────────────

  async reserve(dto: ReserveStockDto) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.assertVariantAndWarehouse(
          tx,
          dto.variantId,
          dto.warehouseId,
        );
        const [physical, reserved] = await Promise.all([
          this.physicalStock(tx, dto.variantId, dto.warehouseId),
          this.reservedStock(tx, dto.variantId, dto.warehouseId),
        ]);
        const available = physical - reserved;
        if (dto.quantity > available) {
          throw new ConflictException(
            `Cannot reserve ${dto.quantity}: only ${available} available`,
          );
        }
        return tx.reservation.create({
          data: {
            variantId: dto.variantId,
            warehouseId: dto.warehouseId,
            quantity: dto.quantity,
            status: ReservationStatus.ACTIVE,
            referenceType: ReferenceType.SO,
            referenceId: dto.referenceId,
            createdBy: dto.createdBy,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async releaseReservation(dto: ReleaseReservationDto) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: dto.reservationId },
    });
    if (!reservation) throw new NotFoundException('Reservation not found');
    if (reservation.status !== ReservationStatus.ACTIVE) {
      throw new BadRequestException(
        `Reservation is ${reservation.status}, cannot release`,
      );
    }
    return this.prisma.reservation.update({
      where: { id: dto.reservationId },
      data: { status: ReservationStatus.RELEASED },
    });
  }

  /**
   * Convert an active reservation into a DISPATCH movement. Releasing the
   * reservation and creating the dispatch happen in one transaction so
   * available stock never briefly double-counts.
   */
  async fulfillReservation(dto: FulfillReservationDto): Promise<StockMovement> {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({
        where: { id: dto.reservationId },
      });
      if (!reservation) throw new NotFoundException('Reservation not found');
      if (reservation.status !== ReservationStatus.ACTIVE) {
        throw new BadRequestException(
          `Reservation is ${reservation.status}, cannot fulfill`,
        );
      }
      await this.assertNotLockedByStockTake(tx, reservation.warehouseId);

      await tx.reservation.update({
        where: { id: reservation.id },
        data: { status: ReservationStatus.FULFILLED },
      });

      return this.recordMovementRaw(tx, {
        variantId: reservation.variantId,
        warehouseId: reservation.warehouseId,
        type: MovementType.DISPATCH,
        signedQty: signedQuantity(
          MovementType.DISPATCH,
          reservation.quantity,
        ),
        referenceType: ReferenceType.SO,
        referenceId: reservation.referenceId ?? reservation.id,
        reason: 'Reservation fulfilled',
        createdBy: dto.createdBy,
      });
    });
  }

  // ── FEFO batch allocation ───────────────────────────────────

  /**
   * First-Expired-First-Out: pick batches with the nearest expiry first.
   * Batches with no expiry sort last. Returns the batches, not the movements.
   */
  async suggestFefoBatches(
    client: PrismaTx | PrismaService,
    variantId: string,
    warehouseId: string,
    quantity: number,
  ): Promise<{ batch: Batch; take: number }[]> {
    const batches = await client.batch.findMany({
      where: {
        variantId,
        warehouseId,
        quantityRemaining: { gt: 0 },
      },
      orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
    });

    const plan: { batch: Batch; take: number }[] = [];
    let remaining = quantity;
    for (const batch of batches) {
      if (remaining <= 0) break;
      const take = Math.min(batch.quantityRemaining, remaining);
      plan.push({ batch, take });
      remaining -= take;
    }
    return plan;
  }

  private async dispatchFefo(
    tx: PrismaTx,
    dto: DispatchStockDto,
  ): Promise<StockMovement[]> {
    const plan = await this.suggestFefoBatches(
      tx,
      dto.variantId,
      dto.warehouseId,
      dto.quantity,
    );
    const planned = plan.reduce((s, p) => s + p.take, 0);
    if (planned < dto.quantity) {
      throw new BadRequestException(
        `Not enough batched stock for FEFO dispatch: need ${dto.quantity}, batched ${planned}. ` +
          `Dispatch without useFefo to draw on unbatched stock.`,
      );
    }
    const movements: StockMovement[] = [];
    for (const { batch, take } of plan) {
      movements.push(
        await this.recordMovementRaw(tx, {
          variantId: dto.variantId,
          warehouseId: dto.warehouseId,
          type: MovementType.DISPATCH,
          signedQty: signedQuantity(MovementType.DISPATCH, take),
          referenceType: dto.referenceType,
          referenceId: dto.referenceId,
          batchId: batch.id,
          reason: dto.reason ?? `FEFO from batch ${batch.batchNumber}`,
          createdBy: dto.createdBy,
        }),
      );
    }
    return movements;
  }

  // ── Movement history ────────────────────────────────────────

  async listMovements(query: MovementQueryDto) {
    const where: Prisma.StockMovementWhereInput = {};
    if (query.variantId) where.variantId = query.variantId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.referenceType) where.referenceType = query.referenceType;
    if (query.referenceId) where.referenceId = query.referenceId;
    if (query.type) where.type = query.type as MovementType;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const limit = query.limit ?? 25;
    const rows = await this.prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor
        ? { cursor: { id: query.cursor }, skip: 1 }
        : {}),
      include: {
        variant: { select: { sku: true, name: true } },
        warehouse: { select: { code: true, name: true } },
        batch: { select: { batchNumber: true, expiryDate: true } },
      },
    });

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    return {
      data,
      meta: {
        count: data.length,
        limit,
        nextCursor: hasMore ? data[data.length - 1].id : null,
        hasMore,
      },
    };
  }

  // ── Internal helpers ────────────────────────────────────────

  private async upsertBatch(
    tx: PrismaTx,
    params: {
      variantId: string;
      warehouseId: string;
      batchNumber: string;
      manufactureDate?: string;
      expiryDate?: string;
    },
  ): Promise<Batch> {
    return tx.batch.upsert({
      where: {
        variantId_warehouseId_batchNumber: {
          variantId: params.variantId,
          warehouseId: params.warehouseId,
          batchNumber: params.batchNumber,
        },
      },
      create: {
        variantId: params.variantId,
        warehouseId: params.warehouseId,
        batchNumber: params.batchNumber,
        manufactureDate: params.manufactureDate
          ? new Date(params.manufactureDate)
          : undefined,
        expiryDate: params.expiryDate
          ? new Date(params.expiryDate)
          : undefined,
        quantityRemaining: 0,
      },
      update: {
        // Keep the earliest known expiry / manufacture info if resupplied.
        manufactureDate: params.manufactureDate
          ? new Date(params.manufactureDate)
          : undefined,
        expiryDate: params.expiryDate
          ? new Date(params.expiryDate)
          : undefined,
      },
    });
  }

  private async assertVariantAndWarehouse(
    client: PrismaTx | PrismaService,
    variantId: string,
    warehouseId: string,
  ): Promise<void> {
    const [variant, warehouse] = await Promise.all([
      client.productVariant.findUnique({
        where: { id: variantId },
        select: { id: true, isActive: true },
      }),
      client.warehouse.findUnique({
        where: { id: warehouseId },
        select: { id: true, isActive: true },
      }),
    ]);
    if (!variant) throw new NotFoundException(`Variant ${variantId} not found`);
    if (!warehouse)
      throw new NotFoundException(`Warehouse ${warehouseId} not found`);
  }

  private async assertWarehouse(
    client: PrismaTx | PrismaService,
    warehouseId: string,
  ): Promise<void> {
    const warehouse = await client.warehouse.findUnique({
      where: { id: warehouseId },
      select: { id: true },
    });
    if (!warehouse)
      throw new NotFoundException(`Warehouse ${warehouseId} not found`);
  }
}

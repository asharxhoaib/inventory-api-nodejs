import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Alert, AlertStatus, AlertType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { AlertsGateway } from './alerts.gateway';

export interface CreateAlertData {
  type: AlertType;
  variantId?: string | null;
  warehouseId?: string | null;
  message: string;
  metadata?: Prisma.InputJsonValue;
}

export interface FindActiveFilter {
  type?: AlertType;
  warehouseId?: string;
}

export interface FindAllQuery {
  status?: AlertStatus;
  type?: AlertType;
  warehouseId?: string;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly gateway: AlertsGateway,
  ) {}

  // ── CRUD ────────────────────────────────────────────────────

  /**
   * Create an alert and push it to websocket clients. Deduped: if an ACTIVE
   * alert with the same type + variantId + warehouseId already exists, the
   * existing row is returned untouched and nothing is emitted.
   */
  async create(data: CreateAlertData): Promise<Alert> {
    const existing = await this.prisma.alert.findFirst({
      where: {
        type: data.type,
        variantId: data.variantId ?? null,
        warehouseId: data.warehouseId ?? null,
        status: AlertStatus.ACTIVE,
      },
    });
    if (existing) {
      return existing;
    }

    const alert = await this.prisma.alert.create({
      data: {
        type: data.type,
        variantId: data.variantId ?? null,
        warehouseId: data.warehouseId ?? null,
        message: data.message,
        status: AlertStatus.ACTIVE,
        metadata: data.metadata,
      },
    });

    this.gateway.emitAlert(alert);
    return alert;
  }

  findActive(filter: FindActiveFilter = {}): Promise<Alert[]> {
    return this.prisma.alert.findMany({
      where: {
        status: AlertStatus.ACTIVE,
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findAll(query: FindAllQuery = {}): Promise<Alert[]> {
    return this.prisma.alert.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async acknowledge(id: string): Promise<Alert> {
    await this.getOrThrow(id);
    return this.prisma.alert.update({
      where: { id },
      data: { status: AlertStatus.ACKNOWLEDGED },
    });
  }

  async resolve(id: string): Promise<Alert> {
    await this.getOrThrow(id);
    return this.prisma.alert.update({
      where: { id },
      data: { status: AlertStatus.RESOLVED },
    });
  }

  // ── Scans ───────────────────────────────────────────────────

  /**
   * Scan for variant/warehouse pairs at or below their reorder point and raise
   * a LOW_STOCK alert for each. Pairs that have since recovered have their
   * ACTIVE LOW_STOCK alerts auto-resolved so the list reflects live state.
   */
  async runLowStockScan(): Promise<{ created: number; resolved: number }> {
    const levels = await this.stock.getStockLevels({ belowReorderPoint: true });

    // Enrich with the labels/thresholds the message and metadata need.
    const variantIds = [...new Set(levels.map((l) => l.variantId))];
    const warehouseIds = [...new Set(levels.map((l) => l.warehouseId))];

    const [variants, warehouses] = await Promise.all([
      this.prisma.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: {
          id: true,
          sku: true,
          product: { select: { reorderPoint: true } },
        },
      }),
      this.prisma.warehouse.findMany({
        where: { id: { in: warehouseIds } },
        select: { id: true, code: true },
      }),
    ]);
    const variantMap = new Map(variants.map((v) => [v.id, v]));
    const warehouseMap = new Map(warehouses.map((w) => [w.id, w.code]));

    // Snapshot the currently-active pairs so we can report how many alerts are
    // genuinely new (create() dedupes, so a repeated pair is not a new row).
    const activeBefore = await this.prisma.alert.findMany({
      where: { type: AlertType.LOW_STOCK, status: AlertStatus.ACTIVE },
      select: { variantId: true, warehouseId: true },
    });
    const activeBeforeKeys = new Set(
      activeBefore.map((a) => `${a.variantId}:${a.warehouseId}`),
    );

    let created = 0;
    const belowKeys = new Set<string>();
    for (const level of levels) {
      const key = `${level.variantId}:${level.warehouseId}`;
      belowKeys.add(key);
      const variant = variantMap.get(level.variantId);
      const reorderPoint = variant?.product.reorderPoint ?? 0;
      const sku = variant?.sku ?? level.variantId;
      const code = warehouseMap.get(level.warehouseId) ?? level.warehouseId;

      await this.create({
        type: AlertType.LOW_STOCK,
        variantId: level.variantId,
        warehouseId: level.warehouseId,
        message: `Low stock: ${sku} at ${code} — ${level.physical} <= reorder point ${reorderPoint}`,
        metadata: { physical: level.physical, reorderPoint },
      });
      if (!activeBeforeKeys.has(key)) {
        created += 1;
      }
    }

    // Auto-resolve recovered alerts: ACTIVE LOW_STOCK whose pair is no longer
    // below reorder point.
    const activeLowStock = await this.prisma.alert.findMany({
      where: { type: AlertType.LOW_STOCK, status: AlertStatus.ACTIVE },
      select: { id: true, variantId: true, warehouseId: true },
    });
    const toResolve = activeLowStock.filter(
      (a) => !belowKeys.has(`${a.variantId}:${a.warehouseId}`),
    );
    if (toResolve.length > 0) {
      await this.prisma.alert.updateMany({
        where: { id: { in: toResolve.map((a) => a.id) } },
        data: { status: AlertStatus.RESOLVED },
      });
    }

    this.logger.log(
      `Low-stock scan: ${levels.length} below reorder, ${toResolve.length} auto-resolved`,
    );
    return { created, resolved: toResolve.length };
  }

  /**
   * Raise EXPIRING_BATCH alerts for batches with stock remaining that expire
   * within `thresholdDays`. Deduped per batch via metadata.batchId in addition
   * to the type + variant + warehouse dedupe, since one variant/warehouse can
   * hold several batches at once.
   */
  async runExpiryScan(
    thresholdDays: number,
  ): Promise<{ created: number }> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + thresholdDays);

    const batches = await this.prisma.batch.findMany({
      where: {
        quantityRemaining: { gt: 0 },
        expiryDate: { not: null, lte: cutoff },
      },
      include: {
        variant: { select: { sku: true } },
        warehouse: { select: { code: true } },
      },
      orderBy: { expiryDate: 'asc' },
    });

    let created = 0;
    for (const batch of batches) {
      // Per-batch dedupe: skip if an ACTIVE alert already references this batch.
      const existing = await this.prisma.alert.findFirst({
        where: {
          type: AlertType.EXPIRING_BATCH,
          status: AlertStatus.ACTIVE,
          variantId: batch.variantId,
          warehouseId: batch.warehouseId,
          metadata: { path: ['batchId'], equals: batch.id },
        },
      });
      if (existing) {
        continue;
      }

      const expires = batch.expiryDate
        ? batch.expiryDate.toISOString().slice(0, 10)
        : 'unknown';
      const alert = await this.prisma.alert.create({
        data: {
          type: AlertType.EXPIRING_BATCH,
          variantId: batch.variantId,
          warehouseId: batch.warehouseId,
          message: `Batch ${batch.batchNumber} expires ${expires}`,
          status: AlertStatus.ACTIVE,
          metadata: {
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            sku: batch.variant.sku,
            warehouseCode: batch.warehouse.code,
            expiryDate: batch.expiryDate?.toISOString() ?? null,
            quantityRemaining: batch.quantityRemaining,
          },
        },
      });
      this.gateway.emitAlert(alert);
      created += 1;
    }

    this.logger.log(
      `Expiry scan: ${batches.length} expiring batches, ${created} new alerts`,
    );
    return { created };
  }

  // ── Internal ────────────────────────────────────────────────

  private async getOrThrow(id: string): Promise<Alert> {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) {
      throw new NotFoundException(`Alert ${id} not found`);
    }
    return alert;
  }
}

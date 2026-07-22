import { Injectable, Logger } from '@nestjs/common';
import { MovementType, Prisma, ValuationMethod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import {
  StockValuationReport,
  ValuationService,
} from './valuation.service';

export interface MovementSummaryFilter {
  from?: string;
  to?: string;
  warehouseId?: string;
  type?: MovementType;
  variantId?: string;
}

export interface MovementSummaryLine {
  type: MovementType;
  totalQuantity: number;
  count: number;
}

export interface MovementSummaryReport {
  byType: MovementSummaryLine[];
  totals: { totalQuantity: number; count: number };
  movements: Array<{
    id: string;
    createdAt: Date;
    type: MovementType;
    quantity: number;
    unitCost: number | null;
    variantId: string;
    variantSku: string;
    variantName: string;
    warehouseId: string;
    warehouseName: string;
  }>;
}

export interface LowStockRow {
  variantId: string;
  variantSku: string;
  variantName: string;
  warehouseId: string;
  warehouseName: string;
  physical: number;
  reserved: number;
  available: number;
  reorderPoint: number;
  reorderQuantity: number;
}

export interface ExpiringBatchRow {
  batchId: string;
  batchNumber: string;
  variantId: string;
  variantSku: string;
  variantName: string;
  warehouseId: string;
  warehouseName: string;
  quantityRemaining: number;
  expiryDate: Date;
  daysUntilExpiry: number;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly valuation: ValuationService,
  ) {}

  // ── Stock valuation ─────────────────────────────────────────

  stockValuation(filter: {
    warehouseId?: string;
    categoryId?: string;
    method?: ValuationMethod;
  }): Promise<StockValuationReport> {
    return this.valuation.stockValuationReport(filter);
  }

  // ── Movement summary ────────────────────────────────────────

  /**
   * Group movements by type over an optional date/warehouse/variant window,
   * returning per-type totals and a flat filtered list of the movements.
   */
  async movementSummary(
    filter: MovementSummaryFilter,
  ): Promise<MovementSummaryReport> {
    const where: Prisma.StockMovementWhereInput = {};
    if (filter.warehouseId) where.warehouseId = filter.warehouseId;
    if (filter.variantId) where.variantId = filter.variantId;
    if (filter.type) where.type = filter.type;
    if (filter.from || filter.to) {
      where.createdAt = {};
      if (filter.from) where.createdAt.gte = new Date(filter.from);
      if (filter.to) where.createdAt.lte = new Date(filter.to);
    }

    const [grouped, movements] = await Promise.all([
      this.prisma.stockMovement.groupBy({
        by: ['type'],
        where,
        _sum: { quantity: true },
        _count: { _all: true },
      }),
      this.prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          variant: { select: { sku: true, name: true } },
          warehouse: { select: { name: true } },
        },
      }),
    ]);

    const byType: MovementSummaryLine[] = grouped
      .map((g) => ({
        type: g.type,
        totalQuantity: g._sum.quantity ?? 0,
        count: g._count._all,
      }))
      .sort((a, b) => a.type.localeCompare(b.type));

    const totals = byType.reduce(
      (acc, line) => ({
        totalQuantity: acc.totalQuantity + line.totalQuantity,
        count: acc.count + line.count,
      }),
      { totalQuantity: 0, count: 0 },
    );

    return {
      byType,
      totals,
      movements: movements.map((m) => ({
        id: m.id,
        createdAt: m.createdAt,
        type: m.type,
        quantity: m.quantity,
        unitCost: m.unitCost === null ? null : Number(m.unitCost),
        variantId: m.variantId,
        variantSku: m.variant.sku,
        variantName: m.variant.name,
        warehouseId: m.warehouseId,
        warehouseName: m.warehouse.name,
      })),
    };
  }

  // ── Low stock ───────────────────────────────────────────────

  /**
   * Variant/warehouse pairs at or below their product reorder point, joined
   * with the SKU/name and reorder settings.
   */
  async lowStock(): Promise<LowStockRow[]> {
    const levels = await this.stock.getStockLevels({
      belowReorderPoint: true,
    });
    if (levels.length === 0) return [];

    const variantIds = [...new Set(levels.map((l) => l.variantId))];
    const warehouseIds = [...new Set(levels.map((l) => l.warehouseId))];

    const [variants, warehouses] = await Promise.all([
      this.prisma.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: {
          id: true,
          sku: true,
          name: true,
          product: {
            select: { reorderPoint: true, reorderQuantity: true },
          },
        },
      }),
      this.prisma.warehouse.findMany({
        where: { id: { in: warehouseIds } },
        select: { id: true, name: true },
      }),
    ]);

    const variantMap = new Map(variants.map((v) => [v.id, v]));
    const warehouseMap = new Map(warehouses.map((w) => [w.id, w]));

    return levels
      .map((level) => {
        const variant = variantMap.get(level.variantId);
        const warehouse = warehouseMap.get(level.warehouseId);
        if (!variant || !warehouse) return null;
        return {
          variantId: level.variantId,
          variantSku: variant.sku,
          variantName: variant.name,
          warehouseId: level.warehouseId,
          warehouseName: warehouse.name,
          physical: level.physical,
          reserved: level.reserved,
          available: level.available,
          reorderPoint: variant.product.reorderPoint,
          reorderQuantity: variant.product.reorderQuantity,
        };
      })
      .filter((row): row is LowStockRow => row !== null);
  }

  // ── Expiring batches ────────────────────────────────────────

  /**
   * Batches with stock remaining whose expiry falls within the next `days`,
   * ordered soonest-first, annotated with days-until-expiry.
   */
  async expiringBatches(days = 30): Promise<ExpiringBatchRow[]> {
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const batches = await this.prisma.batch.findMany({
      where: {
        quantityRemaining: { gt: 0 },
        expiryDate: { not: null, lte: cutoff },
      },
      orderBy: { expiryDate: 'asc' },
      include: {
        variant: { select: { sku: true, name: true } },
        warehouse: { select: { name: true } },
      },
    });

    return batches.map((batch) => {
      const expiryDate = batch.expiryDate as Date;
      const daysUntilExpiry = Math.ceil(
        (expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      );
      return {
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        variantId: batch.variantId,
        variantSku: batch.variant.sku,
        variantName: batch.variant.name,
        warehouseId: batch.warehouseId,
        warehouseName: batch.warehouse.name,
        quantityRemaining: batch.quantityRemaining,
        expiryDate,
        daysUntilExpiry,
      };
    });
  }
}

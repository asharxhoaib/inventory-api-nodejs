import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ValuationMethod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Minimal shape the pure valuation helpers need from a movement row. Keeping it
 * this narrow is what makes the helpers unit-testable without a database — any
 * object with a signed `quantity` and an optional `unitCost` works.
 */
export interface ValuationMovement {
  quantity: number;
  unitCost: Prisma.Decimal | number | string | null;
  createdAt?: Date;
}

export interface FifoLayer {
  quantity: number;
  unitCost: number;
  value: number;
}

export interface FifoValuation {
  quantity: number;
  totalValue: number;
  layers: FifoLayer[];
}

export interface VariantValuation {
  variantId: string;
  warehouseId: string;
  quantity: number;
  unitCost: number;
  totalValue: number;
  method: ValuationMethod;
}

export interface VariantValuationRow extends VariantValuation {
  variantSku: string;
  variantName: string;
  productName: string;
  categoryId: string | null;
  categoryName: string;
  warehouseName: string;
  warehouseCode: string;
}

interface ValuationGroup {
  key: string;
  name: string;
  quantity: number;
  totalValue: number;
  lines: VariantValuationRow[];
}

export interface StockValuationReport {
  method: ValuationMethod | 'MIXED';
  rows: VariantValuationRow[];
  byCategory: ValuationGroup[];
  byWarehouse: ValuationGroup[];
  grandTotal: { quantity: number; totalValue: number };
}

const MONEY_DP = 2;

function toNumber(
  value: Prisma.Decimal | number | string | null | undefined,
): number {
  if (value === null || value === undefined) return 0;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  return typeof value === 'number' ? value : Number(value);
}

function round(value: Prisma.Decimal, dp = MONEY_DP): number {
  return Number(value.toDecimalPlaces(dp).toString());
}

// ── Pure helpers (no I/O, unit-tested directly) ────────────────

/**
 * Weighted-average unit cost across the inbound movements that carry a
 * unitCost: sum(qty * unitCost) / sum(qty). Movements without a unitCost, and
 * outbound (non-positive) movements, are ignored. Returns 0 when there is no
 * priced inbound quantity.
 */
export function weightedAverageCost(movements: ValuationMovement[]): number {
  let qtySum = new Prisma.Decimal(0);
  let costSum = new Prisma.Decimal(0);

  for (const m of movements) {
    const qty = toNumber(m.quantity);
    if (qty <= 0 || m.unitCost === null || m.unitCost === undefined) continue;
    const unitCost = new Prisma.Decimal(toNumber(m.unitCost));
    qtySum = qtySum.add(qty);
    costSum = costSum.add(unitCost.mul(qty));
  }

  if (qtySum.isZero()) return 0;
  return round(costSum.div(qtySum), 4);
}

/**
 * FIFO valuation. Build inbound cost layers oldest-first, consume the total
 * outbound quantity from the oldest layers, then value `quantityOnHand` against
 * the oldest surviving layers. Returns the valued quantity, its total value and
 * the layers consumed to reach it.
 */
export function fifoValuation(
  movements: ValuationMovement[],
  quantityOnHand: number,
): FifoValuation {
  const layers = movements
    .filter((m) => toNumber(m.quantity) > 0 && m.unitCost !== null && m.unitCost !== undefined)
    .map((m) => ({
      remaining: toNumber(m.quantity),
      unitCost: new Prisma.Decimal(toNumber(m.unitCost)),
    }));

  let outbound = movements
    .filter((m) => toNumber(m.quantity) < 0)
    .reduce((sum, m) => sum + Math.abs(toNumber(m.quantity)), 0);

  // Consume outbound from the oldest layers first.
  for (const layer of layers) {
    if (outbound <= 0) break;
    const take = Math.min(layer.remaining, outbound);
    layer.remaining -= take;
    outbound -= take;
  }

  // Value the on-hand quantity against the surviving layers, oldest first.
  let toValue = Math.max(0, quantityOnHand);
  let totalValue = new Prisma.Decimal(0);
  const used: FifoLayer[] = [];

  for (const layer of layers) {
    if (toValue <= 0) break;
    if (layer.remaining <= 0) continue;
    const take = Math.min(layer.remaining, toValue);
    const value = layer.unitCost.mul(take);
    totalValue = totalValue.add(value);
    used.push({
      quantity: take,
      unitCost: round(layer.unitCost, 4),
      value: round(value),
    });
    toValue -= take;
  }

  return {
    quantity: quantityOnHand,
    totalValue: round(totalValue),
    layers: used,
  };
}

@Injectable()
export class ValuationService {
  private readonly logger = new Logger(ValuationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private defaultMethod(): ValuationMethod {
    const configured = this.config.get<'FIFO' | 'WEIGHTED_AVERAGE'>(
      'business.defaultValuationMethod',
    );
    return configured === 'FIFO'
      ? ValuationMethod.FIFO
      : ValuationMethod.WEIGHTED_AVERAGE;
  }

  /**
   * Value a single variant/warehouse pair with the chosen method. Loads every
   * movement oldest-first, derives physical quantity from their signed sum, then
   * applies the FIFO or weighted-average helper.
   */
  async computeVariantValuation(
    variantId: string,
    warehouseId: string,
    method?: ValuationMethod,
  ): Promise<VariantValuation> {
    const chosen = method ?? this.defaultMethod();

    const movements = await this.prisma.stockMovement.findMany({
      where: { variantId, warehouseId },
      orderBy: { createdAt: 'asc' },
      select: { quantity: true, unitCost: true, createdAt: true },
    });

    const quantity = movements.reduce((sum, m) => sum + m.quantity, 0);

    let unitCost = 0;
    let totalValue = 0;

    if (quantity > 0) {
      if (chosen === ValuationMethod.FIFO) {
        const fifo = fifoValuation(movements, quantity);
        totalValue = fifo.totalValue;
        unitCost = round(
          new Prisma.Decimal(totalValue).div(quantity),
          4,
        );
      } else {
        unitCost = weightedAverageCost(movements);
        totalValue = round(new Prisma.Decimal(unitCost).mul(quantity));
      }
    }

    return {
      variantId,
      warehouseId,
      quantity,
      unitCost,
      totalValue,
      method: chosen,
    };
  }

  /**
   * Full stock valuation report. Enumerates every variant/warehouse pair that
   * carries stock, values each, joins in the product/category/warehouse names
   * and rolls the lines up into category and warehouse subtotals plus a grand
   * total.
   */
  async stockValuationReport(filter: {
    warehouseId?: string;
    categoryId?: string;
    method?: ValuationMethod;
  }): Promise<StockValuationReport> {
    const where: Prisma.StockMovementWhereInput = {};
    if (filter.warehouseId) where.warehouseId = filter.warehouseId;
    if (filter.categoryId) {
      where.variant = { product: { categoryId: filter.categoryId } };
    }

    const groups = await this.prisma.stockMovement.groupBy({
      by: ['variantId', 'warehouseId'],
      where,
      _sum: { quantity: true },
    });

    const inStock = groups.filter((g) => (g._sum.quantity ?? 0) > 0);

    const variantIds = [...new Set(inStock.map((g) => g.variantId))];
    const warehouseIds = [...new Set(inStock.map((g) => g.warehouseId))];

    const [variants, warehouses] = await Promise.all([
      this.prisma.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: {
          id: true,
          sku: true,
          name: true,
          product: {
            select: {
              name: true,
              categoryId: true,
              valuationMethod: true,
              category: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.warehouse.findMany({
        where: { id: { in: warehouseIds } },
        select: { id: true, name: true, code: true },
      }),
    ]);

    const variantMap = new Map(variants.map((v) => [v.id, v]));
    const warehouseMap = new Map(warehouses.map((w) => [w.id, w]));

    const rows: VariantValuationRow[] = [];
    const methodsSeen = new Set<ValuationMethod>();

    for (const group of inStock) {
      const variant = variantMap.get(group.variantId);
      const warehouse = warehouseMap.get(group.warehouseId);
      if (!variant || !warehouse) continue;

      const method =
        filter.method ?? variant.product.valuationMethod ?? this.defaultMethod();

      const valuation = await this.computeVariantValuation(
        group.variantId,
        group.warehouseId,
        method,
      );
      if (valuation.quantity <= 0) continue;
      methodsSeen.add(valuation.method);

      rows.push({
        ...valuation,
        variantSku: variant.sku,
        variantName: variant.name,
        productName: variant.product.name,
        categoryId: variant.product.category?.id ?? null,
        categoryName: variant.product.category?.name ?? 'Uncategorized',
        warehouseName: warehouse.name,
        warehouseCode: warehouse.code,
      });
    }

    const byCategory = this.groupRows(
      rows,
      (r) => r.categoryId ?? 'uncategorized',
      (r) => r.categoryName,
    );
    const byWarehouse = this.groupRows(
      rows,
      (r) => r.warehouseId,
      (r) => r.warehouseName,
    );

    const grandTotal = rows.reduce(
      (acc, r) => ({
        quantity: acc.quantity + r.quantity,
        totalValue: round(
          new Prisma.Decimal(acc.totalValue).add(r.totalValue),
        ),
      }),
      { quantity: 0, totalValue: 0 },
    );

    return {
      method:
        methodsSeen.size === 1
          ? [...methodsSeen][0]
          : filter.method ?? (methodsSeen.size > 1 ? 'MIXED' : this.defaultMethod()),
      rows,
      byCategory,
      byWarehouse,
      grandTotal,
    };
  }

  private groupRows(
    rows: VariantValuationRow[],
    keyOf: (r: VariantValuationRow) => string,
    nameOf: (r: VariantValuationRow) => string,
  ): ValuationGroup[] {
    const map = new Map<string, ValuationGroup>();
    for (const row of rows) {
      const key = keyOf(row);
      let group = map.get(key);
      if (!group) {
        group = { key, name: nameOf(row), quantity: 0, totalValue: 0, lines: [] };
        map.set(key, group);
      }
      group.quantity += row.quantity;
      group.totalValue = round(
        new Prisma.Decimal(group.totalValue).add(row.totalValue),
      );
      group.lines.push(row);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  MovementType,
  POItem,
  Prisma,
  PurchaseOrder,
  PurchaseOrderStatus,
  ReferenceType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { signedQuantity } from '../stock/stock.constants';
import { generatePoNumber } from '../../common/utils/sku.util';
import {
  buildCursorPage,
  PaginatedResult,
} from '../../common/dto/pagination.dto';
import { CreatePoDto, CreatePoItemDto } from './dto/create-po.dto';
import { UpdatePoDto } from './dto/update-po.dto';
import { ReceivePoDto } from './dto/receive-po.dto';

export interface FindAllPosQuery {
  status?: PurchaseOrderStatus;
  supplierId?: string;
  cursor?: string;
  limit?: number;
}

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  // ── Create ──────────────────────────────────────────────────

  async create(dto: CreatePoDto): Promise<PurchaseOrder> {
    const poNumber = generatePoNumber(new Date().getFullYear());
    const totalAmount = this.computeTotal(dto.items);

    return this.prisma.$transaction(async (tx) => {
      return tx.purchaseOrder.create({
        data: {
          poNumber,
          supplierId: dto.supplierId,
          warehouseId: dto.warehouseId,
          status: PurchaseOrderStatus.DRAFT,
          expectedDelivery: dto.expectedDelivery
            ? new Date(dto.expectedDelivery)
            : undefined,
          notes: dto.notes,
          totalAmount,
          createdBy: dto.createdBy,
          items: {
            create: dto.items.map((item) => ({
              variantId: item.variantId,
              orderedQuantity: item.orderedQuantity,
              unitPrice: new Prisma.Decimal(item.unitPrice),
            })),
          },
        },
        include: { items: true },
      });
    });
  }

  // ── Reads ───────────────────────────────────────────────────

  async findAll(
    query: FindAllPosQuery,
  ): Promise<PaginatedResult<PurchaseOrder>> {
    const where: Prisma.PurchaseOrderWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.supplierId) where.supplierId = query.supplierId;

    const limit = query.limit ?? 25;
    const rows = await this.prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { items: true },
    });

    return buildCursorPage(rows, limit);
  }

  async findOne(id: string): Promise<PurchaseOrder> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        items: { include: { variant: true } },
        supplier: true,
        warehouse: true,
      },
    });
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    return po;
  }

  // ── Update (DRAFT only) ─────────────────────────────────────

  async update(id: string, dto: UpdatePoDto): Promise<PurchaseOrder> {
    const po = await this.findOne(id);
    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException(
        `Purchase order ${id} is ${po.status}; only DRAFT orders can be edited`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const data: Prisma.PurchaseOrderUpdateInput = {};
      if (dto.notes !== undefined) data.notes = dto.notes;
      if (dto.expectedDelivery !== undefined) {
        data.expectedDelivery = new Date(dto.expectedDelivery);
      }

      // Replacing the lines recomputes the total.
      if (dto.items) {
        await tx.pOItem.deleteMany({ where: { poId: id } });
        data.items = {
          create: dto.items.map((item) => ({
            variantId: item.variantId,
            orderedQuantity: item.orderedQuantity,
            unitPrice: new Prisma.Decimal(item.unitPrice),
          })),
        };
        data.totalAmount = this.computeTotal(dto.items);
      }

      return tx.purchaseOrder.update({
        where: { id },
        data,
        include: { items: true },
      });
    });
  }

  // ── Submit ──────────────────────────────────────────────────

  async submit(id: string): Promise<PurchaseOrder> {
    const po = await this.findOne(id);
    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException(
        `Purchase order ${id} is ${po.status}; only DRAFT orders can be submitted`,
      );
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.SUBMITTED },
      include: { items: true },
    });

    // Placeholder for supplier notification (email/EDI/etc.).
    this.logger.log(
      `Notifying supplier ${po.supplierId}: PO ${po.poNumber} submitted`,
    );

    return updated;
  }

  // ── Receive ─────────────────────────────────────────────────

  async receive(id: string, dto: ReceivePoDto): Promise<PurchaseOrder> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);

    if (
      po.status === PurchaseOrderStatus.CLOSED ||
      po.status === PurchaseOrderStatus.CANCELED
    ) {
      throw new BadRequestException(
        `Purchase order ${id} is ${po.status}; cannot receive against it`,
      );
    }

    const warehouseId = dto.warehouseId ?? po.warehouseId;

    return this.prisma.$transaction(async (tx) => {
      for (const line of dto.items) {
        const poItem = po.items.find((i) => i.id === line.poItemId);
        if (!poItem) {
          throw new NotFoundException(
            `PO item ${line.poItemId} not found on purchase order ${id}`,
          );
        }

        const newReceived = poItem.receivedQuantity + line.receivedQuantity;
        if (newReceived > poItem.orderedQuantity) {
          this.logger.warn(
            `Over-receiving PO item ${poItem.id}: received ${newReceived} of ${poItem.orderedQuantity} ordered`,
          );
        }

        await tx.pOItem.update({
          where: { id: poItem.id },
          data: { receivedQuantity: newReceived },
        });

        // RECEIVE stock strictly through StockService, inside this transaction.
        await this.stock.recordMovementRaw(tx, {
          variantId: poItem.variantId,
          warehouseId,
          type: MovementType.RECEIVE,
          signedQty: signedQuantity(
            MovementType.RECEIVE,
            line.receivedQuantity,
          ),
          referenceType: ReferenceType.PO,
          referenceId: po.id,
          unitCost: Number(poItem.unitPrice),
          reason: `PO ${po.poNumber} receipt`,
          createdBy: dto.createdBy,
        });

        // Reflect the update locally so the completeness check below is accurate.
        poItem.receivedQuantity = newReceived;
      }

      const fullyReceived = po.items.every(
        (i) => i.receivedQuantity >= i.orderedQuantity,
      );
      const anyReceived = po.items.some((i) => i.receivedQuantity > 0);

      let status = po.status;
      let receivedAt: Date | undefined;
      if (fullyReceived) {
        status = PurchaseOrderStatus.RECEIVED;
        receivedAt = new Date();
      } else if (anyReceived) {
        status = PurchaseOrderStatus.PARTIALLY_RECEIVED;
      }

      return tx.purchaseOrder.update({
        where: { id },
        data: { status, receivedAt },
        include: { items: true },
      });
    });
  }

  // ── Close ───────────────────────────────────────────────────

  async close(id: string): Promise<PurchaseOrder> {
    const po = await this.findOne(id);
    if (
      po.status !== PurchaseOrderStatus.RECEIVED &&
      po.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED
    ) {
      throw new BadRequestException(
        `Purchase order ${id} is ${po.status}; only RECEIVED or PARTIALLY_RECEIVED orders can be closed`,
      );
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.CLOSED },
      include: { items: true },
    });
  }

  // ── Cancel ──────────────────────────────────────────────────

  async cancel(id: string): Promise<PurchaseOrder> {
    const po = await this.findOne(id);
    if (
      po.status !== PurchaseOrderStatus.DRAFT &&
      po.status !== PurchaseOrderStatus.SUBMITTED
    ) {
      throw new BadRequestException(
        `Purchase order ${id} is ${po.status}; only DRAFT or SUBMITTED orders can be canceled`,
      );
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.CANCELED },
      include: { items: true },
    });
  }

  // ── Internal helpers ────────────────────────────────────────

  private computeTotal(
    items: Pick<CreatePoItemDto, 'orderedQuantity' | 'unitPrice'>[],
  ): Prisma.Decimal {
    return items.reduce(
      (sum, item) =>
        sum.add(new Prisma.Decimal(item.unitPrice).mul(item.orderedQuantity)),
      new Prisma.Decimal(0),
    );
  }
}

// Type kept for callers/tests that inspect line shape without pulling Prisma types.
export type { POItem };

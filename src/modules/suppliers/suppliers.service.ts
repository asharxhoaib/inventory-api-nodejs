import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProductSupplier,
  PurchaseOrderStatus,
  Supplier,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { LinkProductDto } from './dto/link-product.dto';

export interface SupplierPerformance {
  supplierId: string;
  totalPos: number;
  receivedPos: number;
  onTimePos: number;
  // Fraction of received POs delivered on or before expectedDelivery.
  // Null when there are no received POs to measure against.
  onTimeRate: number | null;
  avgLeadTimeDays: number;
}

@Injectable()
export class SuppliersService {
  private readonly logger = new Logger(SuppliersService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── CRUD ────────────────────────────────────────────────────

  async create(dto: CreateSupplierDto): Promise<Supplier> {
    try {
      return await this.prisma.supplier.create({
        data: {
          name: dto.name,
          code: dto.code,
          email: dto.email,
          phone: dto.phone,
          address: dto.address as Prisma.InputJsonValue | undefined,
          paymentTerms: dto.paymentTerms,
          leadTimeDays: dto.leadTimeDays,
          isActive: dto.isActive,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Supplier code ${dto.code} already exists`,
        );
      }
      throw err;
    }
  }

  async findAll(isActive?: boolean): Promise<Supplier[]> {
    const where: Prisma.SupplierWhereInput = {};
    if (isActive !== undefined) where.isActive = isActive;
    return this.prisma.supplier.findMany({
      where,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        products: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
          orderBy: { priority: 'asc' },
        },
      },
    });
    if (!supplier) throw new NotFoundException(`Supplier ${id} not found`);
    return supplier;
  }

  async update(id: string, dto: UpdateSupplierDto): Promise<Supplier> {
    await this.assertExists(id);
    try {
      return await this.prisma.supplier.update({
        where: { id },
        data: {
          name: dto.name,
          code: dto.code,
          email: dto.email,
          phone: dto.phone,
          address: dto.address as Prisma.InputJsonValue | undefined,
          paymentTerms: dto.paymentTerms,
          leadTimeDays: dto.leadTimeDays,
          isActive: dto.isActive,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Supplier code ${dto.code} already exists`,
        );
      }
      throw err;
    }
  }

  /** Soft delete — a supplier is deactivated, never removed, so historical
   * purchase orders keep a valid reference. */
  async remove(id: string): Promise<Supplier> {
    await this.assertExists(id);
    return this.prisma.supplier.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ── Product links ───────────────────────────────────────────

  /**
   * Link a product to this supplier, or update the terms if the link already
   * exists. The (productId, supplierId) pair is unique, so this upserts.
   */
  async linkProduct(
    supplierId: string,
    dto: LinkProductDto,
  ): Promise<ProductSupplier> {
    await this.assertExists(supplierId);
    return this.prisma.productSupplier.upsert({
      where: {
        productId_supplierId: {
          productId: dto.productId,
          supplierId,
        },
      },
      create: {
        productId: dto.productId,
        supplierId,
        priority: dto.priority,
        supplierSku: dto.supplierSku,
        unitPrice:
          dto.unitPrice !== undefined
            ? new Prisma.Decimal(dto.unitPrice)
            : undefined,
      },
      update: {
        priority: dto.priority,
        supplierSku: dto.supplierSku,
        unitPrice:
          dto.unitPrice !== undefined
            ? new Prisma.Decimal(dto.unitPrice)
            : undefined,
      },
    });
  }

  async unlinkProduct(
    supplierId: string,
    productId: string,
  ): Promise<ProductSupplier> {
    const link = await this.prisma.productSupplier.findUnique({
      where: { productId_supplierId: { productId, supplierId } },
    });
    if (!link) {
      throw new NotFoundException(
        `Product ${productId} is not linked to supplier ${supplierId}`,
      );
    }
    return this.prisma.productSupplier.delete({
      where: { productId_supplierId: { productId, supplierId } },
    });
  }

  // ── Performance ─────────────────────────────────────────────

  /**
   * On-time delivery performance for a supplier. Measured over purchase orders
   * that have actually been received (status RECEIVED or CLOSED with a
   * receivedAt). A PO counts as on time when receivedAt <= expectedDelivery.
   * POs without an expectedDelivery cannot be judged and are excluded from the
   * on-time numerator/denominator, though they still count toward totalPos.
   */
  async getPerformance(supplierId: string): Promise<SupplierPerformance> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, leadTimeDays: true },
    });
    if (!supplier) {
      throw new NotFoundException(`Supplier ${supplierId} not found`);
    }

    const totalPos = await this.prisma.purchaseOrder.count({
      where: { supplierId },
    });

    const receivedOrders = await this.prisma.purchaseOrder.findMany({
      where: {
        supplierId,
        status: {
          in: [PurchaseOrderStatus.RECEIVED, PurchaseOrderStatus.CLOSED],
        },
        receivedAt: { not: null },
      },
      select: { receivedAt: true, expectedDelivery: true },
    });

    const receivedPos = receivedOrders.length;
    let measurablePos = 0;
    let onTimePos = 0;
    for (const po of receivedOrders) {
      if (!po.receivedAt || !po.expectedDelivery) continue;
      measurablePos += 1;
      if (po.receivedAt.getTime() <= po.expectedDelivery.getTime()) {
        onTimePos += 1;
      }
    }

    return {
      supplierId,
      totalPos,
      receivedPos,
      onTimePos,
      onTimeRate: measurablePos === 0 ? null : onTimePos / measurablePos,
      avgLeadTimeDays: supplier.leadTimeDays,
    };
  }

  // ── Internal helpers ────────────────────────────────────────

  private async assertExists(id: string): Promise<void> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundException(`Supplier ${id} not found`);
  }
}

import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Product, ProductVariant } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildCursorPage,
  PaginatedResult,
} from '../../common/dto/pagination.dto';
import {
  generateProductSku,
  generateVariantSku,
} from '../../common/utils/sku.util';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { QueryProductDto } from './dto/query-product.dto';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductDto): Promise<Product> {
    const sku = dto.sku ?? generateProductSku();

    const product = await this.prisma.product.create({
      data: {
        name: dto.name,
        sku,
        barcode: dto.barcode,
        description: dto.description,
        categoryId: dto.categoryId,
        unitOfMeasure: dto.unitOfMeasure,
        weight:
          dto.weight !== undefined ? new Prisma.Decimal(dto.weight) : undefined,
        dimensions: dto.dimensions as Prisma.InputJsonValue | undefined,
        reorderPoint: dto.reorderPoint,
        reorderQuantity: dto.reorderQuantity,
        valuationMethod: dto.valuationMethod,
      },
    });
    this.logger.log(`Created product ${product.id} (${product.sku})`);
    return product;
  }

  /**
   * List products with optional search. `name` is a case-insensitive contains
   * match; `sku` and `barcode` are exact. Results are cursor-paginated.
   */
  async findAll(query: QueryProductDto): Promise<PaginatedResult<Product>> {
    const where: Prisma.ProductWhereInput = {};
    if (query.name) {
      where.name = { contains: query.name, mode: 'insensitive' };
    }
    if (query.sku) where.sku = query.sku;
    if (query.barcode) where.barcode = query.barcode;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.isActive !== undefined) where.isActive = query.isActive;

    const limit = query.limit ?? 25;
    const rows = await this.prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    return buildCursorPage(rows, limit);
  }

  /** Fetch a single product including its variants. */
  async findOne(id: string): Promise<Product & { variants: ProductVariant[] }> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { variants: true },
    });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    await this.assertExists(id);

    return this.prisma.product.update({
      where: { id },
      data: {
        name: dto.name,
        sku: dto.sku,
        barcode: dto.barcode,
        description: dto.description,
        categoryId: dto.categoryId,
        unitOfMeasure: dto.unitOfMeasure,
        weight:
          dto.weight !== undefined ? new Prisma.Decimal(dto.weight) : undefined,
        dimensions: dto.dimensions as Prisma.InputJsonValue | undefined,
        reorderPoint: dto.reorderPoint,
        reorderQuantity: dto.reorderQuantity,
        valuationMethod: dto.valuationMethod,
      },
    });
  }

  /** Soft delete — flips isActive to false, preserving history. */
  async remove(id: string): Promise<Product> {
    await this.assertExists(id);
    this.logger.log(`Soft-deleting product ${id}`);
    return this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * Add a variant to a product. When no SKU is supplied it is derived from the
   * parent SKU plus a slug of the attributes.
   */
  async addVariant(
    productId: string,
    dto: CreateVariantDto,
  ): Promise<ProductVariant> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, sku: true },
    });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);

    const sku = dto.sku ?? generateVariantSku(product.sku, dto.attributes);

    const variant = await this.prisma.productVariant.create({
      data: {
        productId,
        name: dto.name,
        sku,
        barcode: dto.barcode,
        attributes: dto.attributes as Prisma.InputJsonValue | undefined,
      },
    });
    this.logger.log(
      `Added variant ${variant.id} (${variant.sku}) to product ${productId}`,
    );
    return variant;
  }

  private async assertExists(id: string): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
  }
}

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsService } from './products.service';

jest.mock('../../common/utils/sku.util', () => ({
  generateProductSku: jest.fn(() => 'PRD-GEN01'),
  generateVariantSku: jest.fn(() => 'PRD-GEN01-RD-L'),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const sku = require('../../common/utils/sku.util');

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: {
    product: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    productVariant: { create: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      product: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      productVariant: { create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('auto-generates a SKU when none is supplied', async () => {
      prisma.product.create.mockResolvedValue({ id: 'p1', sku: 'PRD-GEN01' });

      await service.create({ name: 'Widget' });

      expect(sku.generateProductSku).toHaveBeenCalledTimes(1);
      expect(prisma.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sku: 'PRD-GEN01', name: 'Widget' }),
        }),
      );
    });

    it('uses the supplied SKU verbatim', async () => {
      prisma.product.create.mockResolvedValue({ id: 'p1', sku: 'MY-SKU' });

      await service.create({ name: 'Widget', sku: 'MY-SKU' });

      expect(sku.generateProductSku).not.toHaveBeenCalled();
      expect(prisma.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sku: 'MY-SKU' }),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('builds a case-insensitive name filter and paginates', async () => {
      prisma.product.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);

      const result = await service.findAll({ name: 'wid', limit: 1 });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: { contains: 'wid', mode: 'insensitive' } },
          take: 2,
        }),
      );
      // limit 1 with 2 rows returned -> hasMore true, one item of data
      expect(result.meta.hasMore).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.meta.nextCursor).toBe('p1');
    });
  });

  describe('findOne', () => {
    it('returns the product with its variants', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 'p1', variants: [] });

      const product = await service.findOne('p1');

      expect(prisma.product.findUnique).toHaveBeenCalledWith({
        where: { id: 'p1' },
        include: { variants: true },
      });
      expect(product).toEqual({ id: 'p1', variants: [] });
    });

    it('throws NotFoundException when missing', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.update('nope', { name: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.product.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('soft-deletes by setting isActive to false', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 'p1' });
      prisma.product.update.mockResolvedValue({ id: 'p1', isActive: false });

      const result = await service.remove('p1');

      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { isActive: false },
      });
      expect(result.isActive).toBe(false);
    });

    it('throws NotFoundException when the product is missing', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.remove('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('addVariant', () => {
    it('auto-generates a variant SKU from the parent SKU and attributes', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        sku: 'PRD-GEN01',
      });
      prisma.productVariant.create.mockResolvedValue({
        id: 'v1',
        sku: 'PRD-GEN01-RD-L',
      });

      await service.addVariant('p1', {
        name: 'Red L',
        attributes: { color: 'Red', size: 'L' },
      });

      expect(sku.generateVariantSku).toHaveBeenCalledWith('PRD-GEN01', {
        color: 'Red',
        size: 'L',
      });
      expect(prisma.productVariant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productId: 'p1',
            sku: 'PRD-GEN01-RD-L',
          }),
        }),
      );
    });

    it('throws NotFoundException when the parent product is missing', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(
        service.addVariant('nope', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.productVariant.create).not.toHaveBeenCalled();
    });
  });
});

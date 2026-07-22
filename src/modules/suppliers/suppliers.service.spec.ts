import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SuppliersService } from './suppliers.service';

type MockPrisma = {
  supplier: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  productSupplier: {
    upsert: jest.Mock;
    findUnique: jest.Mock;
    delete: jest.Mock;
  };
  purchaseOrder: {
    count: jest.Mock;
    findMany: jest.Mock;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    supplier: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    productSupplier: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    purchaseOrder: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

describe('SuppliersService', () => {
  let service: SuppliersService;
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new SuppliersService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('creates a supplier', async () => {
      const supplier = { id: 's1', name: 'Acme', code: 'ACME' };
      prisma.supplier.create.mockResolvedValue(supplier);

      const result = await service.create({ name: 'Acme', code: 'ACME' });

      expect(result).toBe(supplier);
      expect(prisma.supplier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Acme', code: 'ACME' }),
        }),
      );
    });

    it('maps a unique-constraint violation to ConflictException', async () => {
      prisma.supplier.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.create({ name: 'Acme', code: 'ACME' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the supplier is missing', async () => {
      prisma.supplier.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the supplier with linked products', async () => {
      const supplier = { id: 's1', products: [] };
      prisma.supplier.findUnique.mockResolvedValue(supplier);

      await expect(service.findOne('s1')).resolves.toBe(supplier);
      expect(prisma.supplier.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 's1' },
          include: expect.any(Object),
        }),
      );
    });
  });

  describe('linkProduct', () => {
    it('upserts on the composite productId+supplierId key', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 's1' });
      const link = { id: 'ps1' };
      prisma.productSupplier.upsert.mockResolvedValue(link);

      const result = await service.linkProduct('s1', {
        productId: 'p1',
        priority: 2,
        unitPrice: 9.5,
      });

      expect(result).toBe(link);
      expect(prisma.productSupplier.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { productId_supplierId: { productId: 'p1', supplierId: 's1' } },
        }),
      );
    });

    it('throws NotFoundException when the supplier does not exist', async () => {
      prisma.supplier.findUnique.mockResolvedValue(null);

      await expect(
        service.linkProduct('missing', { productId: 'p1', priority: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.productSupplier.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getPerformance', () => {
    it('computes the on-time rate over measurable received POs', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 's1',
        leadTimeDays: 7,
      });
      prisma.purchaseOrder.count.mockResolvedValue(5);
      prisma.purchaseOrder.findMany.mockResolvedValue([
        // on time
        {
          receivedAt: new Date('2026-01-10'),
          expectedDelivery: new Date('2026-01-12'),
        },
        // exactly on the due date counts as on time
        {
          receivedAt: new Date('2026-02-01'),
          expectedDelivery: new Date('2026-02-01'),
        },
        // late
        {
          receivedAt: new Date('2026-03-05'),
          expectedDelivery: new Date('2026-03-01'),
        },
      ]);

      const perf = await service.getPerformance('s1');

      expect(perf).toEqual({
        supplierId: 's1',
        totalPos: 5,
        receivedPos: 3,
        onTimePos: 2,
        onTimeRate: 2 / 3,
        avgLeadTimeDays: 7,
      });
      expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            supplierId: 's1',
            status: {
              in: [
                PurchaseOrderStatus.RECEIVED,
                PurchaseOrderStatus.CLOSED,
              ],
            },
            receivedAt: { not: null },
          }),
        }),
      );
    });

    it('excludes POs without an expectedDelivery from the rate', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 's1',
        leadTimeDays: 4,
      });
      prisma.purchaseOrder.count.mockResolvedValue(2);
      prisma.purchaseOrder.findMany.mockResolvedValue([
        {
          receivedAt: new Date('2026-01-10'),
          expectedDelivery: new Date('2026-01-12'),
        },
        // received but never scheduled — not measurable
        { receivedAt: new Date('2026-01-15'), expectedDelivery: null },
      ]);

      const perf = await service.getPerformance('s1');

      expect(perf.receivedPos).toBe(2);
      expect(perf.onTimePos).toBe(1);
      expect(perf.onTimeRate).toBe(1); // 1 on time of 1 measurable
    });

    it('returns a null rate with no received POs (divide-by-zero guard)', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 's1',
        leadTimeDays: 7,
      });
      prisma.purchaseOrder.count.mockResolvedValue(1);
      prisma.purchaseOrder.findMany.mockResolvedValue([]);

      const perf = await service.getPerformance('s1');

      expect(perf).toEqual({
        supplierId: 's1',
        totalPos: 1,
        receivedPos: 0,
        onTimePos: 0,
        onTimeRate: null,
        avgLeadTimeDays: 7,
      });
    });

    it('throws NotFoundException for an unknown supplier', async () => {
      prisma.supplier.findUnique.mockResolvedValue(null);

      await expect(
        service.getPerformance('missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

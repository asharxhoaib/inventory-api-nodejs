import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from './stock.service';

/**
 * A minimal Prisma mock. $transaction runs its callback with the same mock
 * object acting as the transaction client, which is enough to exercise the
 * service's aggregation-and-guard logic without a database.
 */
function createPrismaMock() {
  const mock: any = {
    stockMovement: {
      aggregate: jest.fn(),
      create: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
    reservation: {
      aggregate: jest.fn(),
      create: jest.fn(),
      groupBy: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    batch: { update: jest.fn(), upsert: jest.fn(), findMany: jest.fn() },
    productVariant: { findUnique: jest.fn(), findMany: jest.fn() },
    warehouse: { findUnique: jest.fn() },
    stockTake: { findFirst: jest.fn() },
  };
  mock.$transaction = jest.fn((cb: any, _opts?: any) => cb(mock));
  return mock;
}

describe('StockService', () => {
  let service: StockService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(StockService);
  });

  const okVariantWarehouse = () => {
    prisma.productVariant.findUnique.mockResolvedValue({
      id: 'v1',
      isActive: true,
    });
    prisma.warehouse.findUnique.mockResolvedValue({ id: 'w1', isActive: true });
    prisma.stockTake.findFirst.mockResolvedValue(null);
  };

  describe('physical / reserved / available', () => {
    it('physicalStock sums movement quantities', async () => {
      prisma.stockMovement.aggregate.mockResolvedValue({
        _sum: { quantity: 42 },
      });
      await expect(service.physicalStock(prisma as any, 'v1', 'w1')).resolves.toBe(
        42,
      );
    });

    it('treats a null sum as zero', async () => {
      prisma.stockMovement.aggregate.mockResolvedValue({
        _sum: { quantity: null },
      });
      await expect(service.physicalStock(prisma as any, 'v1', 'w1')).resolves.toBe(
        0,
      );
    });

    it('available = physical - reserved', async () => {
      prisma.stockMovement.aggregate.mockResolvedValue({
        _sum: { quantity: 100 },
      });
      prisma.reservation.aggregate.mockResolvedValue({
        _sum: { quantity: 30 },
      });
      const level = await service.getStockLevel('v1', 'w1');
      expect(level).toEqual({
        variantId: 'v1',
        warehouseId: 'w1',
        physical: 100,
        reserved: 30,
        available: 70,
      });
    });
  });

  describe('dispatch overselling guard', () => {
    it('rejects when requested exceeds available', async () => {
      okVariantWarehouse();
      prisma.stockMovement.aggregate.mockResolvedValue({
        _sum: { quantity: 10 },
      });
      prisma.reservation.aggregate.mockResolvedValue({ _sum: { quantity: 8 } });
      // available = 2
      await expect(
        service.dispatch({ variantId: 'v1', warehouseId: 'w1', quantity: 5 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });

    it('creates a negative DISPATCH movement when stock is sufficient', async () => {
      okVariantWarehouse();
      prisma.stockMovement.aggregate.mockResolvedValue({
        _sum: { quantity: 50 },
      });
      prisma.reservation.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
      prisma.stockMovement.create.mockResolvedValue({ id: 'm1', quantity: -5 });

      const [movement] = await service.dispatch({
        variantId: 'v1',
        warehouseId: 'w1',
        quantity: 5,
      });
      expect(movement).toEqual({ id: 'm1', quantity: -5 });
      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'DISPATCH', quantity: -5 }),
        }),
      );
    });
  });

  describe('reservations', () => {
    it('reserve rejects when over available', async () => {
      okVariantWarehouse();
      prisma.stockMovement.aggregate.mockResolvedValue({
        _sum: { quantity: 5 },
      });
      prisma.reservation.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
      await expect(
        service.reserve({ variantId: 'v1', warehouseId: 'w1', quantity: 6 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('reserve creates an ACTIVE reservation when available', async () => {
      okVariantWarehouse();
      prisma.stockMovement.aggregate.mockResolvedValue({
        _sum: { quantity: 20 },
      });
      prisma.reservation.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
      prisma.reservation.create.mockResolvedValue({ id: 'r1', quantity: 6 });
      const res = await service.reserve({
        variantId: 'v1',
        warehouseId: 'w1',
        quantity: 6,
      });
      expect(res).toEqual({ id: 'r1', quantity: 6 });
    });

    it('fulfillReservation converts an active reservation to a DISPATCH', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: 'r1',
        variantId: 'v1',
        warehouseId: 'w1',
        quantity: 4,
        status: 'ACTIVE',
        referenceId: 'so-1',
      });
      prisma.stockTake.findFirst.mockResolvedValue(null);
      prisma.reservation.update.mockResolvedValue({});
      prisma.stockMovement.create.mockResolvedValue({ id: 'm2', quantity: -4 });

      const movement = await service.fulfillReservation({ reservationId: 'r1' });
      expect(prisma.reservation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'FULFILLED' },
        }),
      );
      expect(movement).toEqual({ id: 'm2', quantity: -4 });
    });
  });

  describe('stock-take lock', () => {
    it('blocks a receive while a stock take is in progress', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({
        id: 'v1',
        isActive: true,
      });
      prisma.warehouse.findUnique.mockResolvedValue({ id: 'w1' });
      prisma.stockTake.findFirst.mockResolvedValue({ id: 'st1' });
      await expect(
        service.receive({ variantId: 'v1', warehouseId: 'w1', quantity: 5 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('transfer', () => {
    it('rejects transfer to the same warehouse', async () => {
      await expect(
        service.transfer({
          variantId: 'v1',
          sourceWarehouseId: 'w1',
          destinationWarehouseId: 'w1',
          quantity: 5,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates paired TRANSFER_OUT and TRANSFER_IN movements', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({
        id: 'v1',
        isActive: true,
      });
      prisma.warehouse.findUnique.mockResolvedValue({ id: 'w', isActive: true });
      prisma.stockTake.findFirst.mockResolvedValue(null);
      prisma.stockMovement.aggregate.mockResolvedValue({
        _sum: { quantity: 30 },
      });
      prisma.reservation.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
      prisma.stockMovement.create
        .mockResolvedValueOnce({ id: 'out', quantity: -5 })
        .mockResolvedValueOnce({ id: 'in', quantity: 5 });

      const movements = await service.transfer({
        variantId: 'v1',
        sourceWarehouseId: 'w1',
        destinationWarehouseId: 'w2',
        quantity: 5,
      });
      expect(movements.map((m) => m.id)).toEqual(['out', 'in']);
      expect(prisma.stockMovement.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({ type: 'TRANSFER_OUT', quantity: -5 }),
        }),
      );
      expect(prisma.stockMovement.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({ type: 'TRANSFER_IN', quantity: 5 }),
        }),
      );
    });
  });
});

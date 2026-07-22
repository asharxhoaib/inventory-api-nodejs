import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { MovementType, ReferenceType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { StockTakesService } from './stock-takes.service';

describe('StockTakesService', () => {
  let service: StockTakesService;
  let prisma: {
    stockTake: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    stockTakeItem: { createMany: jest.Mock; upsert: jest.Mock };
    stockMovement: { groupBy: jest.Mock };
    $transaction: jest.Mock;
  };
  let stock: { recordMovementRaw: jest.Mock };

  beforeEach(async () => {
    prisma = {
      stockTake: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      stockTakeItem: { createMany: jest.fn(), upsert: jest.fn() },
      stockMovement: { groupBy: jest.fn() },
      // Handles both call styles: a callback (create/complete) and an
      // array of promises (recordCounts). tx is the prisma mock itself.
      $transaction: jest.fn((arg) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
    };
    stock = { recordMovementRaw: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockTakesService,
        { provide: PrismaService, useValue: prisma },
        { provide: StockService, useValue: stock },
      ],
    }).compile();

    service = module.get<StockTakesService>(StockTakesService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('rejects when the warehouse already has an in-progress take', async () => {
      prisma.stockTake.findFirst.mockResolvedValue({ id: 'st-active' });

      await expect(
        service.create({ warehouseId: 'w1' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.stockTake.create).not.toHaveBeenCalled();
    });

    it('snapshots each variant with stock as an expected item', async () => {
      prisma.stockTake.findFirst.mockResolvedValue(null);
      prisma.stockTake.create.mockResolvedValue({ id: 'st1' });
      prisma.stockMovement.groupBy.mockResolvedValue([
        { variantId: 'v1', _sum: { quantity: 10 } },
        { variantId: 'v2', _sum: { quantity: 4 } },
      ]);

      await service.create({ warehouseId: 'w1' });

      expect(prisma.stockTakeItem.createMany).toHaveBeenCalledWith({
        data: [
          { stockTakeId: 'st1', variantId: 'v1', expectedQuantity: 10 },
          { stockTakeId: 'st1', variantId: 'v2', expectedQuantity: 4 },
        ],
      });
    });
  });

  describe('complete', () => {
    it('posts adjustments only for non-zero counted differences and sets COMPLETED', async () => {
      prisma.stockTake.findUnique.mockResolvedValue({
        id: 'st1',
        warehouseId: 'w1',
        status: 'IN_PROGRESS',
        createdBy: 'auditor',
        items: [
          { variantId: 'v1', expectedQuantity: 10, actualQuantity: 12, difference: 2 },
          { variantId: 'v2', expectedQuantity: 5, actualQuantity: 5, difference: 0 },
          { variantId: 'v3', expectedQuantity: 3, actualQuantity: null, difference: null },
        ],
      });
      prisma.stockTake.update.mockResolvedValue({
        id: 'st1',
        status: 'COMPLETED',
      });

      const result = await service.complete('st1');

      // Only v1 (non-zero, counted) yields an adjustment.
      expect(stock.recordMovementRaw).toHaveBeenCalledTimes(1);
      expect(stock.recordMovementRaw).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          variantId: 'v1',
          warehouseId: 'w1',
          type: MovementType.ADJUSTMENT,
          signedQty: 2,
          referenceType: ReferenceType.STOCK_TAKE,
          referenceId: 'st1',
          reason: 'Stock take adjustment',
        }),
      );

      // Status flipped to COMPLETED before the adjustments were posted.
      expect(prisma.stockTake.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'st1' },
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
      expect(result.status).toBe('COMPLETED');
    });

    it('rejects when the stock take is not in progress', async () => {
      prisma.stockTake.findUnique.mockResolvedValue({
        id: 'st1',
        status: 'COMPLETED',
        items: [],
      });

      await expect(service.complete('st1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(stock.recordMovementRaw).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('flips an in-progress take to CANCELED without posting adjustments', async () => {
      prisma.stockTake.findUnique.mockResolvedValue({
        id: 'st1',
        status: 'IN_PROGRESS',
      });
      prisma.stockTake.update.mockResolvedValue({
        id: 'st1',
        status: 'CANCELED',
      });

      const result = await service.cancel('st1');

      expect(prisma.stockTake.update).toHaveBeenCalledWith({
        where: { id: 'st1' },
        data: { status: 'CANCELED' },
      });
      expect(stock.recordMovementRaw).not.toHaveBeenCalled();
      expect(result.status).toBe('CANCELED');
    });

    it('rejects canceling a take that is not in progress', async () => {
      prisma.stockTake.findUnique.mockResolvedValue({
        id: 'st1',
        status: 'COMPLETED',
      });

      await expect(service.cancel('st1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.stockTake.update).not.toHaveBeenCalled();
    });
  });
});

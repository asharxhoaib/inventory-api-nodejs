import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { BatchesService } from './batches.service';

describe('BatchesService', () => {
  let service: BatchesService;
  let prisma: {
    batch: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let stock: { suggestFefoBatches: jest.Mock };

  beforeEach(async () => {
    prisma = {
      batch: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    stock = { suggestFefoBatches: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchesService,
        { provide: PrismaService, useValue: prisma },
        { provide: StockService, useValue: stock },
      ],
    }).compile();

    service = module.get<BatchesService>(BatchesService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('excludes depleted batches by default', async () => {
      prisma.batch.findMany.mockResolvedValue([]);

      await service.findAll({ limit: 25 });

      expect(prisma.batch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ quantityRemaining: { gt: 0 } }),
        }),
      );
    });

    it('includes depleted batches when includeEmpty is set', async () => {
      prisma.batch.findMany.mockResolvedValue([]);

      await service.findAll({ includeEmpty: true, limit: 25 });

      const arg = prisma.batch.findMany.mock.calls[0][0];
      expect(arg.where.quantityRemaining).toBeUndefined();
    });

    it('applies an expiry cutoff for expiringWithinDays', async () => {
      prisma.batch.findMany.mockResolvedValue([]);
      const before = Date.now();

      await service.findAll({ expiringWithinDays: 7, limit: 25 });

      const arg = prisma.batch.findMany.mock.calls[0][0];
      const cutoff: Date = arg.where.expiryDate.lte;
      expect(cutoff).toBeInstanceOf(Date);
      // ~7 days ahead of now
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(
        before + 7 * 24 * 60 * 60 * 1000,
      );
    });

    it('passes variant and warehouse filters through', async () => {
      prisma.batch.findMany.mockResolvedValue([]);

      await service.findAll({ variantId: 'v1', warehouseId: 'w1', limit: 25 });

      expect(prisma.batch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            variantId: 'v1',
            warehouseId: 'w1',
          }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns the batch when found', async () => {
      prisma.batch.findUnique.mockResolvedValue({ id: 'b1' });

      const batch = await service.findOne('b1');

      expect(batch).toEqual({ id: 'b1' });
    });

    it('throws NotFoundException when missing', async () => {
      prisma.batch.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getExpiring', () => {
    it('filters on remaining stock and an expiry cutoff, ordered asc', async () => {
      prisma.batch.findMany.mockResolvedValue([]);
      const before = Date.now();

      await service.getExpiring(30);

      const arg = prisma.batch.findMany.mock.calls[0][0];
      expect(arg.where.quantityRemaining).toEqual({ gt: 0 });
      expect(arg.where.expiryDate.lte).toBeInstanceOf(Date);
      expect(arg.where.expiryDate.lte.getTime()).toBeGreaterThanOrEqual(
        before + 30 * 24 * 60 * 60 * 1000,
      );
      expect(arg.orderBy).toEqual({ expiryDate: 'asc' });
    });
  });

  describe('getFefoSuggestion', () => {
    it('delegates to StockService.suggestFefoBatches', async () => {
      const plan = [{ batch: { id: 'b1' }, take: 3 }];
      stock.suggestFefoBatches.mockResolvedValue(plan);

      const result = await service.getFefoSuggestion('v1', 'w1', 3);

      expect(stock.suggestFefoBatches).toHaveBeenCalledWith(
        prisma,
        'v1',
        'w1',
        3,
      );
      expect(result).toBe(plan);
    });
  });
});

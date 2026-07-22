import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Alert, AlertStatus, AlertType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { AlertsGateway } from './alerts.gateway';
import { AlertsService } from './alerts.service';

describe('AlertsService', () => {
  let service: AlertsService;
  let prisma: {
    alert: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    productVariant: { findMany: jest.Mock };
    warehouse: { findMany: jest.Mock };
    batch: { findMany: jest.Mock };
  };
  let stock: { getStockLevels: jest.Mock };
  let gateway: { emitAlert: jest.Mock };

  const alert: Alert = {
    id: 'a-1',
    type: AlertType.LOW_STOCK,
    variantId: 'v-1',
    warehouseId: 'wh-1',
    message: 'Low stock',
    status: AlertStatus.ACTIVE,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      alert: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      productVariant: { findMany: jest.fn() },
      warehouse: { findMany: jest.fn() },
      batch: { findMany: jest.fn() },
    };
    stock = { getStockLevels: jest.fn() };
    gateway = { emitAlert: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StockService, useValue: stock },
        { provide: AlertsGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get<AlertsService>(AlertsService);
  });

  describe('create', () => {
    it('creates and emits a new alert', async () => {
      prisma.alert.findFirst.mockResolvedValue(null);
      prisma.alert.create.mockResolvedValue(alert);

      const result = await service.create({
        type: AlertType.LOW_STOCK,
        variantId: 'v-1',
        warehouseId: 'wh-1',
        message: 'Low stock',
      });

      expect(prisma.alert.create).toHaveBeenCalled();
      expect(gateway.emitAlert).toHaveBeenCalledWith(alert);
      expect(result).toEqual(alert);
    });

    it('dedupes an existing ACTIVE alert without creating or emitting', async () => {
      prisma.alert.findFirst.mockResolvedValue(alert);

      const result = await service.create({
        type: AlertType.LOW_STOCK,
        variantId: 'v-1',
        warehouseId: 'wh-1',
        message: 'Low stock again',
      });

      expect(prisma.alert.create).not.toHaveBeenCalled();
      expect(gateway.emitAlert).not.toHaveBeenCalled();
      expect(result).toEqual(alert);
    });
  });

  describe('acknowledge / resolve', () => {
    it('acknowledges an existing alert', async () => {
      prisma.alert.findUnique.mockResolvedValue(alert);
      prisma.alert.update.mockResolvedValue({
        ...alert,
        status: AlertStatus.ACKNOWLEDGED,
      });

      const result = await service.acknowledge('a-1');

      expect(prisma.alert.update).toHaveBeenCalledWith({
        where: { id: 'a-1' },
        data: { status: AlertStatus.ACKNOWLEDGED },
      });
      expect(result.status).toBe(AlertStatus.ACKNOWLEDGED);
    });

    it('resolves an existing alert', async () => {
      prisma.alert.findUnique.mockResolvedValue(alert);
      prisma.alert.update.mockResolvedValue({
        ...alert,
        status: AlertStatus.RESOLVED,
      });

      const result = await service.resolve('a-1');

      expect(prisma.alert.update).toHaveBeenCalledWith({
        where: { id: 'a-1' },
        data: { status: AlertStatus.RESOLVED },
      });
      expect(result.status).toBe(AlertStatus.RESOLVED);
    });

    it('throws NotFoundException when acknowledging a missing alert', async () => {
      prisma.alert.findUnique.mockResolvedValue(null);

      await expect(service.acknowledge('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.alert.update).not.toHaveBeenCalled();
    });
  });

  describe('runLowStockScan', () => {
    it('creates alerts from below-reorder levels and auto-resolves recovered ones', async () => {
      stock.getStockLevels.mockResolvedValue([
        { variantId: 'v-1', warehouseId: 'wh-1', physical: 2, reserved: 0, available: 2 },
      ]);
      prisma.productVariant.findMany.mockResolvedValue([
        { id: 'v-1', sku: 'SKU-1', product: { reorderPoint: 5 } },
      ]);
      prisma.warehouse.findMany.mockResolvedValue([
        { id: 'wh-1', code: 'MAIN' },
      ]);

      // 1st findMany: activeBefore snapshot (none active yet).
      // 2nd findMany: activeLowStock for auto-resolve — includes a stale pair
      //   (v-2/wh-1) that is no longer below reorder.
      prisma.alert.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: 'a-old', variantId: 'v-2', warehouseId: 'wh-1' },
          { id: 'a-1', variantId: 'v-1', warehouseId: 'wh-1' },
        ]);

      // create() path: no existing dupe, then a fresh row.
      prisma.alert.findFirst.mockResolvedValue(null);
      prisma.alert.create.mockResolvedValue(alert);
      prisma.alert.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.runLowStockScan();

      // New alert created for the below-reorder pair.
      expect(prisma.alert.create).toHaveBeenCalledTimes(1);
      expect(gateway.emitAlert).toHaveBeenCalledWith(alert);
      expect(result.created).toBe(1);

      // Only the stale pair (v-2/wh-1) gets auto-resolved; v-1/wh-1 stays active.
      expect(prisma.alert.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['a-old'] } },
        data: { status: AlertStatus.RESOLVED },
      });
      expect(result.resolved).toBe(1);
    });

    it('does not double-count an already-active pair as newly created', async () => {
      stock.getStockLevels.mockResolvedValue([
        { variantId: 'v-1', warehouseId: 'wh-1', physical: 2, reserved: 0, available: 2 },
      ]);
      prisma.productVariant.findMany.mockResolvedValue([
        { id: 'v-1', sku: 'SKU-1', product: { reorderPoint: 5 } },
      ]);
      prisma.warehouse.findMany.mockResolvedValue([{ id: 'wh-1', code: 'MAIN' }]);

      // Pair already active before the scan.
      prisma.alert.findMany
        .mockResolvedValueOnce([{ variantId: 'v-1', warehouseId: 'wh-1' }])
        .mockResolvedValueOnce([{ id: 'a-1', variantId: 'v-1', warehouseId: 'wh-1' }]);
      prisma.alert.findFirst.mockResolvedValue(alert); // dedupe hit
      prisma.alert.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.runLowStockScan();

      expect(prisma.alert.create).not.toHaveBeenCalled();
      expect(result.created).toBe(0);
      expect(result.resolved).toBe(0);
    });
  });
});

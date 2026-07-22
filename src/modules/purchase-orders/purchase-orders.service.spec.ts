import { BadRequestException } from '@nestjs/common';
import {
  MovementType,
  Prisma,
  PurchaseOrderStatus,
  ReferenceType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { PurchaseOrdersService } from './purchase-orders.service';

type MockTx = {
  purchaseOrder: { create: jest.Mock; update: jest.Mock };
  pOItem: { update: jest.Mock; deleteMany: jest.Mock };
};

type MockPrisma = {
  purchaseOrder: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  pOItem: { update: jest.Mock; deleteMany: jest.Mock };
  $transaction: jest.Mock;
};

function createMockTx(): MockTx {
  return {
    purchaseOrder: {
      create: jest.fn((args) => Promise.resolve({ id: 'po1', ...args.data })),
      update: jest.fn((args) => Promise.resolve({ id: 'po1', ...args.data })),
    },
    pOItem: {
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

function createMockPrisma(tx: MockTx): MockPrisma {
  return {
    purchaseOrder: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn((args) => Promise.resolve({ id: 'po1', ...args.data })),
    },
    pOItem: { update: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn((cb: (t: MockTx) => unknown) => cb(tx)),
  };
}

describe('PurchaseOrdersService', () => {
  let service: PurchaseOrdersService;
  let prisma: MockPrisma;
  let tx: MockTx;
  let stock: { recordMovementRaw: jest.Mock };

  beforeEach(() => {
    tx = createMockTx();
    prisma = createMockPrisma(tx);
    stock = { recordMovementRaw: jest.fn().mockResolvedValue({ id: 'm1' }) };
    service = new PurchaseOrdersService(
      prisma as unknown as PrismaService,
      stock as unknown as StockService,
    );
  });

  describe('create', () => {
    it('computes totalAmount and generates a poNumber', async () => {
      await service.create({
        supplierId: 's1',
        warehouseId: 'w1',
        items: [
          { variantId: 'v1', orderedQuantity: 3, unitPrice: 10 },
          { variantId: 'v2', orderedQuantity: 2, unitPrice: 5.5 },
        ],
      });

      expect(tx.purchaseOrder.create).toHaveBeenCalledTimes(1);
      const data = tx.purchaseOrder.create.mock.calls[0][0].data;

      // 3*10 + 2*5.5 = 41
      expect(Number(data.totalAmount)).toBe(41);
      expect(data.poNumber).toMatch(/^PO-\d{4}-/);
      expect(data.status).toBe(PurchaseOrderStatus.DRAFT);
      expect(data.items.create).toHaveLength(2);
    });
  });

  describe('update', () => {
    it('rejects when the PO is not DRAFT', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po1',
        status: PurchaseOrderStatus.SUBMITTED,
        items: [],
      });

      await expect(
        service.update('po1', { notes: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.purchaseOrder.update).not.toHaveBeenCalled();
    });
  });

  describe('receive', () => {
    it('fully received -> RECEIVED and records a RECEIVE movement', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po1',
        poNumber: 'PO-2026-ABCDE',
        warehouseId: 'w1',
        status: PurchaseOrderStatus.SUBMITTED,
        items: [
          {
            id: 'i1',
            variantId: 'v1',
            orderedQuantity: 10,
            receivedQuantity: 0,
            unitPrice: new Prisma.Decimal(5),
          },
        ],
      });

      await service.receive('po1', {
        items: [{ poItemId: 'i1', receivedQuantity: 10 }],
      });

      expect(stock.recordMovementRaw).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          variantId: 'v1',
          warehouseId: 'w1',
          type: MovementType.RECEIVE,
          signedQty: 10,
          referenceType: ReferenceType.PO,
          referenceId: 'po1',
          unitCost: 5,
        }),
      );

      const data = tx.purchaseOrder.update.mock.calls[0][0].data;
      expect(data.status).toBe(PurchaseOrderStatus.RECEIVED);
      expect(data.receivedAt).toBeInstanceOf(Date);
    });

    it('partially received -> PARTIALLY_RECEIVED', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po1',
        poNumber: 'PO-2026-ABCDE',
        warehouseId: 'w1',
        status: PurchaseOrderStatus.SUBMITTED,
        items: [
          {
            id: 'i1',
            variantId: 'v1',
            orderedQuantity: 10,
            receivedQuantity: 0,
            unitPrice: new Prisma.Decimal(5),
          },
        ],
      });

      await service.receive('po1', {
        items: [{ poItemId: 'i1', receivedQuantity: 4 }],
      });

      expect(stock.recordMovementRaw).toHaveBeenCalledTimes(1);
      const data = tx.purchaseOrder.update.mock.calls[0][0].data;
      expect(data.status).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);
      expect(data.receivedAt).toBeUndefined();
    });
  });

  describe('close', () => {
    it('closes a RECEIVED PO', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po1',
        status: PurchaseOrderStatus.RECEIVED,
        items: [],
      });

      await service.close('po1');

      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'po1' },
          data: expect.objectContaining({
            status: PurchaseOrderStatus.CLOSED,
          }),
        }),
      );
    });

    it('rejects closing a DRAFT PO', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po1',
        status: PurchaseOrderStatus.DRAFT,
        items: [],
      });

      await expect(service.close('po1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.purchaseOrder.update).not.toHaveBeenCalled();
    });
  });
});

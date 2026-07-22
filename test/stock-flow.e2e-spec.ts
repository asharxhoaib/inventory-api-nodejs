import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { StockService } from '../src/modules/stock/stock.service';
import { StockModule } from '../src/modules/stock/stock.module';
import { PrismaModule } from '../src/prisma/prisma.module';

/**
 * Integration test for the stock ledger. Requires a real PostgreSQL reachable
 * via DATABASE_URL with the schema migrated (`npx prisma migrate deploy`).
 * Run with: `npm run test:e2e`.
 *
 * It verifies the invariant that current stock equals the sum of movements, and
 * that transfers and the overselling guard behave correctly end to end.
 */
describe('Stock ledger (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stock: StockService;

  let variantId: string;
  let whA: string;
  let whB: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, StockModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
    stock = moduleRef.get(StockService);

    const suffix = Date.now().toString(36);
    const product = await prisma.product.create({
      data: {
        name: `IT Product ${suffix}`,
        sku: `PRD-IT-${suffix}`,
        variants: { create: { name: 'default', sku: `PRD-IT-${suffix}-D` } },
      },
      include: { variants: true },
    });
    variantId = product.variants[0].id;

    const a = await prisma.warehouse.create({
      data: { name: 'IT A', code: `IT-A-${suffix}` },
    });
    const b = await prisma.warehouse.create({
      data: { name: 'IT B', code: `IT-B-${suffix}` },
    });
    whA = a.id;
    whB = b.id;
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { variantId } });
    await prisma.reservation.deleteMany({ where: { variantId } });
    await prisma.productVariant.deleteMany({ where: { id: variantId } });
    await prisma.warehouse.deleteMany({ where: { id: { in: [whA, whB] } } });
    await app.close();
  });

  it('physical stock equals the sum of movements', async () => {
    await stock.receive({ variantId, warehouseId: whA, quantity: 100 });
    await stock.adjust({ variantId, warehouseId: whA, delta: -10 });
    const level = await stock.getStockLevel(variantId, whA);
    expect(level.physical).toBe(90);
  });

  it('transfer moves stock between warehouses without creating or destroying units', async () => {
    await stock.transfer({
      variantId,
      sourceWarehouseId: whA,
      destinationWarehouseId: whB,
      quantity: 40,
    });
    const [a, b] = await Promise.all([
      stock.getStockLevel(variantId, whA),
      stock.getStockLevel(variantId, whB),
    ]);
    expect(a.physical).toBe(50);
    expect(b.physical).toBe(40);
  });

  it('reservation reduces available but not physical, and blocks overselling', async () => {
    const res = await stock.reserve({
      variantId,
      warehouseId: whA,
      quantity: 50,
    });
    const level = await stock.getStockLevel(variantId, whA);
    expect(level.physical).toBe(50);
    expect(level.available).toBe(0);

    await expect(
      stock.dispatch({ variantId, warehouseId: whA, quantity: 1 }),
    ).rejects.toThrow();

    // Fulfilling the reservation turns it into a dispatch.
    await stock.fulfillReservation({ reservationId: res.id });
    const after = await stock.getStockLevel(variantId, whA);
    expect(after.physical).toBe(0);
  });
});

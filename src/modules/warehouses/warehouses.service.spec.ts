import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Warehouse } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WarehousesService } from './warehouses.service';

describe('WarehousesService', () => {
  let service: WarehousesService;
  let prisma: {
    warehouse: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  const warehouse: Warehouse = {
    id: 'wh-1',
    name: 'Main',
    code: 'MAIN',
    address: null,
    capacity: 1000,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      warehouse: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WarehousesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<WarehousesService>(WarehousesService);
  });

  it('creates a warehouse', async () => {
    prisma.warehouse.create.mockResolvedValue(warehouse);

    const result = await service.create({ name: 'Main', code: 'MAIN' });

    expect(prisma.warehouse.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Main', code: 'MAIN' }),
    });
    expect(result).toEqual(warehouse);
  });

  it('lists warehouses ordered by name', async () => {
    prisma.warehouse.findMany.mockResolvedValue([warehouse]);

    const result = await service.findAll();

    expect(prisma.warehouse.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { name: 'asc' },
    });
    expect(result).toEqual([warehouse]);
  });

  it('filters the list by isActive', async () => {
    prisma.warehouse.findMany.mockResolvedValue([warehouse]);

    await service.findAll(true);

    expect(prisma.warehouse.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  });

  it('returns a warehouse by id', async () => {
    prisma.warehouse.findUnique.mockResolvedValue(warehouse);

    const result = await service.findOne('wh-1');

    expect(prisma.warehouse.findUnique).toHaveBeenCalledWith({
      where: { id: 'wh-1' },
    });
    expect(result).toEqual(warehouse);
  });

  it('throws NotFoundException when the warehouse is missing', async () => {
    prisma.warehouse.findUnique.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updates an existing warehouse', async () => {
    prisma.warehouse.findUnique.mockResolvedValue(warehouse);
    prisma.warehouse.update.mockResolvedValue({ ...warehouse, name: 'Depot' });

    const result = await service.update('wh-1', { name: 'Depot' });

    expect(prisma.warehouse.update).toHaveBeenCalledWith({
      where: { id: 'wh-1' },
      data: expect.objectContaining({ name: 'Depot' }),
    });
    expect(result.name).toBe('Depot');
  });

  it('throws when updating a missing warehouse', async () => {
    prisma.warehouse.findUnique.mockResolvedValue(null);

    await expect(
      service.update('missing', { name: 'Depot' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.warehouse.update).not.toHaveBeenCalled();
  });

  it('soft deletes by setting isActive to false', async () => {
    prisma.warehouse.findUnique.mockResolvedValue(warehouse);
    prisma.warehouse.update.mockResolvedValue({
      ...warehouse,
      isActive: false,
    });

    const result = await service.remove('wh-1');

    expect(prisma.warehouse.update).toHaveBeenCalledWith({
      where: { id: 'wh-1' },
      data: { isActive: false },
    });
    expect(result.isActive).toBe(false);
  });

  it('throws when soft deleting a missing warehouse', async () => {
    prisma.warehouse.findUnique.mockResolvedValue(null);

    await expect(service.remove('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.warehouse.update).not.toHaveBeenCalled();
  });
});

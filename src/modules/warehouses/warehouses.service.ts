import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, Warehouse } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';

@Injectable()
export class WarehousesService {
  private readonly logger = new Logger(WarehousesService.name);

  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateWarehouseDto): Promise<Warehouse> {
    return this.prisma.warehouse.create({
      data: {
        name: dto.name,
        code: dto.code,
        address: dto.address as Prisma.InputJsonValue,
        capacity: dto.capacity,
        isActive: dto.isActive,
      },
    });
  }

  findAll(isActive?: boolean): Promise<Warehouse[]> {
    return this.prisma.warehouse.findMany({
      where: isActive === undefined ? undefined : { isActive },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string): Promise<Warehouse> {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!warehouse) {
      throw new NotFoundException(`Warehouse ${id} not found`);
    }
    return warehouse;
  }

  async update(id: string, dto: UpdateWarehouseDto): Promise<Warehouse> {
    await this.findOne(id);
    return this.prisma.warehouse.update({
      where: { id },
      data: {
        name: dto.name,
        code: dto.code,
        address: dto.address as Prisma.InputJsonValue,
        capacity: dto.capacity,
        isActive: dto.isActive,
      },
    });
  }

  async remove(id: string): Promise<Warehouse> {
    await this.findOne(id);
    return this.prisma.warehouse.update({
      where: { id },
      data: { isActive: false },
    });
  }
}

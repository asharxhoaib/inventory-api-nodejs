import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Category } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

export interface CategoryNode extends Category {
  children: CategoryNode[];
}

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCategoryDto): Promise<Category> {
    if (dto.parentId) {
      await this.assertParentExists(dto.parentId);
    }
    const category = await this.prisma.category.create({
      data: { name: dto.name, parentId: dto.parentId },
    });
    this.logger.log(`Created category ${category.id} (${category.name})`);
    return category;
  }

  /**
   * Return the full category forest. Rows are fetched once and assembled into a
   * tree in memory; each root carries its nested `children`.
   */
  async findTree(): Promise<CategoryNode[]> {
    const categories = await this.prisma.category.findMany({
      orderBy: { name: 'asc' },
    });

    const byId = new Map<string, CategoryNode>();
    for (const c of categories) {
      byId.set(c.id, { ...c, children: [] });
    }

    const roots: CategoryNode[] = [];
    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) {
        byId.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  async findOne(id: string): Promise<Category> {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException(`Category ${id} not found`);
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<Category> {
    await this.assertExists(id);

    if (dto.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException('A category cannot be its own parent');
      }
      await this.assertParentExists(dto.parentId);
    }

    return this.prisma.category.update({
      where: { id },
      data: { name: dto.name, parentId: dto.parentId },
    });
  }

  async remove(id: string): Promise<Category> {
    await this.assertExists(id);
    this.logger.log(`Deleting category ${id}`);
    return this.prisma.category.delete({ where: { id } });
  }

  private async assertExists(id: string): Promise<void> {
    const category = await this.prisma.category.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!category) throw new NotFoundException(`Category ${id} not found`);
  }

  private async assertParentExists(parentId: string): Promise<void> {
    const parent = await this.prisma.category.findUnique({
      where: { id: parentId },
      select: { id: true },
    });
    if (!parent) {
      throw new BadRequestException(`Parent category ${parentId} not found`);
    }
  }
}

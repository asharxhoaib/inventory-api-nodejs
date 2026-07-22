import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoriesService } from './categories.service';

describe('CategoriesService', () => {
  let service: CategoriesService;
  let prisma: {
    category: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      category: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates a root category without a parent lookup', async () => {
      prisma.category.create.mockResolvedValue({ id: 'c1', name: 'Root' });

      await service.create({ name: 'Root' });

      expect(prisma.category.findUnique).not.toHaveBeenCalled();
      expect(prisma.category.create).toHaveBeenCalledWith({
        data: { name: 'Root', parentId: undefined },
      });
    });

    it('validates the parent when parentId is supplied', async () => {
      prisma.category.findUnique.mockResolvedValue({ id: 'parent' });
      prisma.category.create.mockResolvedValue({ id: 'c2', name: 'Child' });

      await service.create({ name: 'Child', parentId: 'parent' });

      expect(prisma.category.findUnique).toHaveBeenCalledWith({
        where: { id: 'parent' },
        select: { id: true },
      });
      expect(prisma.category.create).toHaveBeenCalledWith({
        data: { name: 'Child', parentId: 'parent' },
      });
    });

    it('throws BadRequestException for an unknown parent', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ name: 'Child', parentId: 'ghost' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.category.create).not.toHaveBeenCalled();
    });
  });

  describe('findTree', () => {
    it('assembles a nested tree from flat rows', async () => {
      prisma.category.findMany.mockResolvedValue([
        { id: 'root', name: 'Root', parentId: null },
        { id: 'child', name: 'Child', parentId: 'root' },
        { id: 'grandchild', name: 'GC', parentId: 'child' },
        { id: 'other', name: 'Other', parentId: null },
      ]);

      const tree = await service.findTree();

      expect(tree).toHaveLength(2);
      const root = tree.find((n) => n.id === 'root')!;
      expect(root.children).toHaveLength(1);
      expect(root.children[0].id).toBe('child');
      expect(root.children[0].children[0].id).toBe('grandchild');
    });

    it('treats a row with a missing parent as a root', async () => {
      prisma.category.findMany.mockResolvedValue([
        { id: 'orphan', name: 'Orphan', parentId: 'gone' },
      ]);

      const tree = await service.findTree();

      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe('orphan');
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when missing', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('rejects a category set as its own parent', async () => {
      prisma.category.findUnique.mockResolvedValue({ id: 'c1' });

      await expect(
        service.update('c1', { parentId: 'c1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when the category is missing', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(
        service.update('nope', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes an existing category', async () => {
      prisma.category.findUnique.mockResolvedValue({ id: 'c1' });
      prisma.category.delete.mockResolvedValue({ id: 'c1' });

      await service.remove('c1');

      expect(prisma.category.delete).toHaveBeenCalledWith({
        where: { id: 'c1' },
      });
    });

    it('throws NotFoundException when the category is missing', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(service.remove('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@prisma/client';

@Injectable()
export class ProductCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.productCategory.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async create(actorId: string, data: { code?: string; name: string; parentId?: string }) {
    if (data.parentId) {
      const parent = await this.prisma.productCategory.findUnique({ where: { id: data.parentId } });
      if (!parent) throw new BadRequestException('Invalid parentId');
    }

    const created = await this.prisma.productCategory.create({ data });

    await this.audit.log({
      actorId,
      action: AuditAction.CREATE,
      entity: 'ProductCategory',
      entityId: created.id,
      after: created,
      message: `Created product category ${created.name}`,
    });

    return created;
  }

  async update(actorId: string, id: string, data: { name?: string; parentId?: string; isActive?: boolean }) {
    const before = await this.prisma.productCategory.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Category not found');

    if (data.parentId) {
      if (data.parentId === id) throw new BadRequestException('Category cannot be its own parent');
      const parent = await this.prisma.productCategory.findUnique({ where: { id: data.parentId } });
      if (!parent) throw new BadRequestException('Invalid parentId');
    }

    const after = await this.prisma.productCategory.update({ where: { id }, data });

    await this.audit.log({
      actorId,
      action: AuditAction.UPDATE,
      entity: 'ProductCategory',
      entityId: id,
      before,
      after,
      message: `Updated product category ${after.name}`,
    });

    return after;
  }
}
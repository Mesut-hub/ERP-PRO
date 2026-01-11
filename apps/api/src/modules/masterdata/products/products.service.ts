import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@prisma/client';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.product.findMany({
      orderBy: { sku: 'asc' },
      include: {
        baseUnit: true,
        vatRate: true,
        category: true,
        priceCurrency: true,
        attachments: true,
      },
    });
  }

  async create(actorId: string, data: any) {
    const unit = await this.prisma.unit.findUnique({ where: { id: data.baseUnitId } });
    if (!unit) throw new BadRequestException('Invalid baseUnitId');

    const vat = await this.prisma.vatRate.findUnique({ where: { code: data.vatCode } });
    if (!vat) throw new BadRequestException('Invalid vatCode');

    if (data.categoryId) {
      const cat = await this.prisma.productCategory.findUnique({ where: { id: data.categoryId } });
      if (!cat) throw new BadRequestException('Invalid categoryId');
    }

    if (data.priceCurrencyCode) {
      const cur = await this.prisma.currency.findUnique({
        where: { code: data.priceCurrencyCode.toUpperCase() },
      });
      if (!cur) throw new BadRequestException('Invalid priceCurrencyCode');
      data.priceCurrencyCode = cur.code;
    }

    const created = await this.prisma.product.create({
      data: {
        ...data,
        purchasePrice: data.purchasePrice ?? undefined,
        salesPrice: data.salesPrice ?? undefined,
        minStock: data.minStock ?? undefined,
        reorderPoint: data.reorderPoint ?? undefined,
        weightKg: data.weightKg ?? undefined,
        lengthCm: data.lengthCm ?? undefined,
        widthCm: data.widthCm ?? undefined,
        heightCm: data.heightCm ?? undefined,
      },
    });

    await this.audit.log({
      actorId,
      action: AuditAction.CREATE,
      entity: 'Product',
      entityId: created.id,
      after: created,
      message: `Created product ${created.sku}`,
    });

    return created;
  }

  async update(actorId: string, id: string, data: any) {
    const before = await this.prisma.product.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Product not found');

    if (data.baseUnitId) {
      const unit = await this.prisma.unit.findUnique({ where: { id: data.baseUnitId } });
      if (!unit) throw new BadRequestException('Invalid baseUnitId');
    }
    if (data.vatCode) {
      const vat = await this.prisma.vatRate.findUnique({ where: { code: data.vatCode } });
      if (!vat) throw new BadRequestException('Invalid vatCode');
    }
    if (data.categoryId) {
      const cat = await this.prisma.productCategory.findUnique({ where: { id: data.categoryId } });
      if (!cat) throw new BadRequestException('Invalid categoryId');
    }
    if (data.priceCurrencyCode) {
      const cur = await this.prisma.currency.findUnique({
        where: { code: data.priceCurrencyCode.toUpperCase() },
      });
      if (!cur) throw new BadRequestException('Invalid priceCurrencyCode');
      data.priceCurrencyCode = cur.code;
    }

    const after = await this.prisma.product.update({
      where: { id },
      data: {
        ...data,
        purchasePrice: data.purchasePrice ?? undefined,
        salesPrice: data.salesPrice ?? undefined,
        minStock: data.minStock ?? undefined,
        reorderPoint: data.reorderPoint ?? undefined,
        weightKg: data.weightKg ?? undefined,
        lengthCm: data.lengthCm ?? undefined,
        widthCm: data.widthCm ?? undefined,
        heightCm: data.heightCm ?? undefined,
      },
    });

    await this.audit.log({
      actorId,
      action: AuditAction.UPDATE,
      entity: 'Product',
      entityId: id,
      before,
      after,
      message: `Updated product ${after.sku}`,
    });

    return after;
  }
}

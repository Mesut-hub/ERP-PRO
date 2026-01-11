import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction, PartyType, VatRateCode } from '@prisma/client';

@Injectable()
export class PartiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(type?: PartyType) {
    return this.prisma.party.findMany({
      where: { type },
      orderBy: { name: 'asc' },
      include: { contacts: true, defaultCurrency: true, defaultVat: true },
    });
  }

  private async normalizeCurrency(code?: string) {
    if (!code) return undefined;
    const c = await this.prisma.currency.findUnique({ where: { code: code.toUpperCase() } });
    if (!c) throw new BadRequestException('Invalid defaultCurrencyCode');
    return c.code;
  }

  private async validateVat(code?: VatRateCode) {
    if (!code) return;
    const v = await this.prisma.vatRate.findUnique({ where: { code } });
    if (!v) throw new BadRequestException('Invalid defaultVatCode');
  }

  async create(actorId: string, data: any) {
    if (data.defaultCurrencyCode)
      data.defaultCurrencyCode = await this.normalizeCurrency(data.defaultCurrencyCode);
    if (data.defaultVatCode) await this.validateVat(data.defaultVatCode);

    const created = await this.prisma.party.create({
      data: {
        ...data,
        creditLimit: data.creditLimit ?? undefined, // string is ok for Prisma Decimal
      },
    });

    await this.audit.log({
      actorId,
      action: AuditAction.CREATE,
      entity: 'Party',
      entityId: created.id,
      after: created,
      message: `Created party ${created.name} (${created.type})`,
    });

    return created;
  }

  async update(actorId: string, id: string, data: any) {
    const before = await this.prisma.party.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Party not found');

    if (data.defaultCurrencyCode)
      data.defaultCurrencyCode = await this.normalizeCurrency(data.defaultCurrencyCode);
    if (data.defaultVatCode) await this.validateVat(data.defaultVatCode);

    const after = await this.prisma.party.update({
      where: { id },
      data: {
        ...data,
        creditLimit: data.creditLimit ?? undefined,
      },
    });

    await this.audit.log({
      actorId,
      action: AuditAction.UPDATE,
      entity: 'Party',
      entityId: id,
      before,
      after,
      message: `Updated party ${after.name}`,
    });

    return after;
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@prisma/client';

@Injectable()
export class ExchangeRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(params?: { fromCode?: string; toCode?: string; take?: number }) {
    return this.prisma.exchangeRate.findMany({
      where: {
        fromCode: params?.fromCode,
        toCode: params?.toCode,
      },
      orderBy: { rateDate: 'desc' },
      take: params?.take ?? 50,
    });
  }

  async create(
    actorId: string,
    data: { fromCode: string; toCode: string; rate: string; rateDate: string },
  ) {
    const fromCode = data.fromCode.toUpperCase();
    const toCode = data.toCode.toUpperCase();

    if (fromCode === toCode) throw new BadRequestException('fromCode and toCode must differ');

    const from = await this.prisma.currency.findUnique({ where: { code: fromCode } });
    const to = await this.prisma.currency.findUnique({ where: { code: toCode } });
    if (!from || !to) throw new BadRequestException('Invalid currency code(s)');
    if (!from.isActive || !to.isActive) throw new BadRequestException('Currency inactive');

    const created = await this.prisma.exchangeRate.create({
      data: {
        fromCode,
        toCode,
        rate: data.rate as any,
        rateDate: new Date(data.rateDate),
        source: 'manual',
      },
    });

    await this.audit.log({
      actorId,
      action: AuditAction.CREATE,
      entity: 'ExchangeRate',
      entityId: created.id,
      after: created,
      message: `Exchange rate ${fromCode}->${toCode}=${data.rate} on ${data.rateDate}`,
    });

    return created;
  }
}
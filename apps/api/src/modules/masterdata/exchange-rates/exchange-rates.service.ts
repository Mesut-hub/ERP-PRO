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

  // NOTE: replace your current create() implementation with this idempotent one
  async create(dto: { fromCode: string; toCode: string; rate: string; rateDate: string }) {
    const fromCode = dto.fromCode.toUpperCase().trim();
    const toCode = dto.toCode.toUpperCase().trim();

    const rate = Number(dto.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new BadRequestException('rate must be > 0');

    const rateDate = new Date(dto.rateDate);
    if (Number.isNaN(rateDate.getTime())) {
      throw new BadRequestException('rateDate must be a valid ISO 8601 date string');
    }

    const from = await this.prisma.currency.findUnique({ where: { code: fromCode } });
    const to = await this.prisma.currency.findUnique({ where: { code: toCode } });
    if (!from || !to) throw new BadRequestException('Invalid currency code(s)');
    if (!from.isActive || !to.isActive) throw new BadRequestException('Currency inactive');

    // IMPORTANT: idempotent upsert (prevents 500 P2002)
    return this.prisma.exchangeRate.upsert({
      where: { fromCode_toCode_rateDate: { fromCode, toCode, rateDate } },
      update: { rate: rate.toFixed(8) as any },
      create: { fromCode, toCode, rateDate, rate: rate.toFixed(8) as any },
    });
  }
}
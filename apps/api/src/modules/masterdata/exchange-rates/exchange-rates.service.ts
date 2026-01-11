import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExchangeRateDto } from './dto/create-exchange-rate.dto';

@Injectable()
export class ExchangeRatesService {
  constructor(private readonly prisma: PrismaService) {}

  private toIstanbulDayKey(d: Date): Date {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);

    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (!y || !m || !day)
      throw new BadRequestException('Failed to normalize date to Europe/Istanbul day');

    return new Date(`${y}-${m}-${day}T00:00:00.000Z`);
  }

  async list(params: { fromCode?: string; toCode?: string; take?: number }) {
    return this.prisma.exchangeRate.findMany({
      where: {
        fromCode: params.fromCode,
        toCode: params.toCode,
      },
      orderBy: { rateDate: 'desc' },
      take: params.take ?? 100,
    });
  }

  async create(actorId: string, dto: CreateExchangeRateDto) {
    // Defensive checks to avoid 500 even if body parsing fails
    if (!dto) throw new BadRequestException('Request body is required');
    if (!dto.fromCode || !dto.toCode)
      throw new BadRequestException('fromCode and toCode are required');
    if (!dto.rate) throw new BadRequestException('rate is required');
    if (!dto.rateDate) throw new BadRequestException('rateDate is required');

    const fromCode = dto.fromCode.toUpperCase().trim();
    const toCode = dto.toCode.toUpperCase().trim();

    const rateNum = Number(dto.rate);
    if (!Number.isFinite(rateNum) || rateNum <= 0)
      throw new BadRequestException('rate must be > 0');

    const parsed = new Date(dto.rateDate);
    if (Number.isNaN(parsed.getTime()))
      throw new BadRequestException('rateDate must be a valid ISO 8601 date string');

    const rateDate = this.toIstanbulDayKey(parsed);

    const from = await this.prisma.currency.findUnique({ where: { code: fromCode } });
    const to = await this.prisma.currency.findUnique({ where: { code: toCode } });
    if (!from || !to) throw new BadRequestException('Invalid currency code(s)');
    if (!from.isActive || !to.isActive) throw new BadRequestException('Currency inactive');

    return this.prisma.exchangeRate.upsert({
      where: { fromCode_toCode_rateDate: { fromCode, toCode, rateDate } },
      update: {
        rate: rateNum.toFixed(8) as any,
        source: 'manual',
      },
      create: {
        fromCode,
        toCode,
        rateDate,
        rate: rateNum.toFixed(8) as any,
        source: 'manual',
      },
    });
  }
}

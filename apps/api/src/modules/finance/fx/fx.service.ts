import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type CurrencyCode = string; // e.g. "TRY", "USD", "EUR"

@Injectable()
export class FxService {
  constructor(
    private readonly prisma: PrismaService
  ) {}

  /**
   * Normalize any datetime into Istanbul "day key" stored as DateTime at 00:00.
   * We store as UTC Date object representing that Istanbul day at 00:00 local.
   *
   * NOTE: This is a pragmatic approach. Later, you can store rateDate as DATE type.
   */
  toIstanbulDayKey(d: Date): Date {
    // Convert to ISO date in Europe/Istanbul, then create a Date at 00:00Z of that date.
    // This keeps a stable day key without extra libs.
    const parts = new Intl.DateTimeFormat('en-CA', { 
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit' 
    }).formatToParts(d);

    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    if (!y || !m || !day) throw new BadRequestException('Failed to normalize date');
    // Use UTC midnight of that calendar date as the day key
    return new Date(`${y}-${m}-${day}T00:00:00.000Z`);
  }

  private async getDirectRate(fromCode: string, toCode: string, when: Date): Promise<number | null> {
    const dayKey = this.toIstanbulDayKey(when);
    const row = await this.prisma.exchangeRate.findFirst({
      where: { fromCode, toCode, rateDate: dayKey },
      select: { rate: true },
    });
    return row ? Number(row.rate) : null;
  }

  /**
   * Professional ERP rule:
   * - rates are "daily official" (CBRT), not intraday tick.
   * - derive cross rates via TRY.
   */
  async getRate(fromCodeRaw: string, toCodeRaw: string, when: Date): Promise<number> {
    const fromCode = fromCodeRaw.toUpperCase();
    const toCode = toCodeRaw.toUpperCase();

    if (fromCode === toCode) return 1;

    // direct exists?
    const direct = await this.getDirectRate(fromCode, toCode, when);
    if (direct && direct > 0) return direct;

    // We treat TRY as base pivot
    if (toCode === 'TRY') {
      const r = await this.getDirectRate(fromCode, 'TRY', when);
      if (!r || r <= 0) this.throwMissing(fromCode, 'TRY', when);
      return r;
    }

    if (fromCode === 'TRY') {
      const r = await this.getDirectRate(toCode, 'TRY', when);
      if (!r || r <= 0) this.throwMissing(toCode, 'TRY', when);
      return 1 / r;
    }

    // cross via TRY: from->TRY divided by to->TRY
    const fromTry = await this.getDirectRate(fromCode, 'TRY', when);
    if (!fromTry || fromTry <= 0) this.throwMissing(fromCode, 'TRY', when);

    const toTry = await this.getDirectRate(toCode, 'TRY', when);
    if (!toTry || toTry <= 0) this.throwMissing(toCode, 'TRY', when);

    return fromTry / toTry;
  }

  private throwMissing(fromCode: string, toCode: string, when: Date): never {
    const dayKey = this.toIstanbulDayKey(when);
    const ymd = dayKey.toISOString().slice(0, 10);
    throw new BadRequestException(`Missing exchange rate ${fromCode}->${toCode} for Istanbul day ${ymd}`);
  }
}
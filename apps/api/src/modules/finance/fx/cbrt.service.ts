import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FxService } from './fx.service';
import { XMLParser } from 'fast-xml-parser';

type CbrtRateRow = { fromCode: string; toCode: string; rate: string };

@Injectable()
export class CbrtService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
  ) {}

  /**
   * Sync official CBRT daily rates for a given Istanbul day.
   *
   * Stores canonical pairs:
   *   fromCode = CCY (USD/EUR/...)
   *   toCode   = TRY
   * using ForexSelling (professional default).
   *
   * date: "YYYY-MM-DD" (optional; if omitted uses today)
   */
  async syncDaily(date?: string) {
    const d = date ? new Date(`${date}T12:00:00.000Z`) : new Date();
    if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date');

    const dayKey = this.fx.toIstanbulDayKey(d);
    const ymd = dayKey.toISOString().slice(0, 10);

    await this.ensureCurrency('TRY');

    const xml = await this.fetchCbrtXml(ymd);
    const rates = this.parseForexSellingTryRates(xml);

    let upserted = 0;
    const results: CbrtRateRow[] = [];

    for (const [fromCodeRaw, rateNum] of Object.entries(rates)) {
      const fromCode = fromCodeRaw.toUpperCase().trim();
      if (fromCode.length !== 3 || fromCode === 'TRY') continue;

      if (!Number.isFinite(rateNum) || rateNum <= 0) continue;

      await this.ensureCurrency(fromCode);

      await this.upsertRate(fromCode, 'TRY', dayKey, rateNum, 'CBRT');
      upserted += 1;
      results.push({ fromCode, toCode: 'TRY', rate: rateNum.toFixed(8) });
    }

    results.sort((a, b) => a.fromCode.localeCompare(b.fromCode));

    return {
      ok: true,
      rateDate: ymd,
      source: 'CBRT',
      method: 'FOREX_SELLING',
      upserted,
      results,
    };
  }

  async upsertRate(fromCode: string, toCode: string, when: Date, rate: number, source: string) {
    const dayKey = this.fx.toIstanbulDayKey(when);
    return this.prisma.exchangeRate.upsert({
      where: { fromCode_toCode_rateDate: { fromCode, toCode, rateDate: dayKey } },
      update: { rate: rate.toFixed(8) as any, source },
      create: { fromCode, toCode, rateDate: dayKey, rate: rate.toFixed(8) as any, source },
    });
  }

  private async fetchCbrtXml(ymd: string): Promise<string> {
    const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) throw new BadRequestException('Invalid ymd format');

    const yyyy = m[1];
    const mm = m[2];
    const dd = m[3];

    // https://www.tcmb.gov.tr/kurlar/YYYYMM/DDMMYYYY.xml
    const url = `https://www.tcmb.gov.tr/kurlar/${yyyy}${mm}/${dd}${mm}${yyyy}.xml`;

    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'ERP-PRO/1.0 (CBRT Sync)' },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BadRequestException(
        `CBRT fetch failed for ${ymd}. status=${res.status}. body=${text?.slice(0, 200) ?? ''}`,
      );
    }

    return res.text();
  }

  /**
   * Returns map { USD: 30.1234, EUR: 32.5678, ... } where values are TRY per 1 unit.
   * Uses ForexSelling.
   */
  private parseForexSellingTryRates(xml: string): Record<string, number> {
    if (!xml?.trim()) throw new BadRequestException('Empty CBRT XML');

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      // CBRT XML is simple; keep defaults otherwise
      trimValues: true,
      parseTagValue: false,
    });

    let doc: any;
    try {
      doc = parser.parse(xml);
    } catch (e: any) {
      throw new BadRequestException(`Failed to parse CBRT XML: ${e?.message ?? e}`);
    }

    // Expected: doc.Tarih_Date.Currency is array (or object for single)
    const root = doc?.Tarih_Date;
    const currenciesRaw = root?.Currency;
    if (!currenciesRaw) throw new BadRequestException('CBRT XML: missing Currency list');

    const currencies: any[] = Array.isArray(currenciesRaw) ? currenciesRaw : [currenciesRaw];

    const out: Record<string, number> = {};

    for (const c of currencies) {
      const code = String(c?.CurrencyCode ?? '').toUpperCase().trim();
      if (!code || code.length !== 3) continue;

      // ForexSelling may be missing for some currencies
      const fsRaw = c?.ForexSelling;
      if (fsRaw === undefined || fsRaw === null) continue;

      const n = Number(String(fsRaw).replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0) continue;

      out[code] = n;
    }

    if (Object.keys(out).length === 0) {
      throw new BadRequestException('CBRT XML parsed but no ForexSelling rates found');
    }

    return out;
  }

  private async ensureCurrency(code: string) {
    const existing = await this.prisma.currency.findUnique({ where: { code } });
    if (existing) return existing;

    return this.prisma.currency.create({
      data: {
        code,
        name: code,
        symbol: null,
        isBase: code === 'TRY',
        isActive: true,
      },
    });
  }
}
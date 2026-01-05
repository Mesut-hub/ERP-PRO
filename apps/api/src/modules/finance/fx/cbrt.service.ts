import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FxService } from './fx.service';

@Injectable()
export class CbrtService {
  constructor(private readonly prisma: PrismaService, private readonly fx: FxService) {}

  async syncDaily(date?: string) {
    const d = date ? new Date(`${date}T12:00:00.000Z`) : new Date();
    const dayKey = this.fx.toIstanbulDayKey(d);

    // TODO: fetch CBRT XML and parse USD/TRY + EUR/TRY
    // For now, throw to prevent false confidence:
    throw new BadRequestException('CBRT sync not implemented yet: next step is to add XML fetch + parse');
  }

  async upsertRate(fromCode: string, toCode: string, when: Date, rate: number, source: string) {
    const dayKey = this.fx.toIstanbulDayKey(when);
    return this.prisma.exchangeRate.upsert({
      where: {
        fromCode_toCode_rateDate: { fromCode, toCode, rateDate: dayKey },
      },
      update: { rate: rate.toFixed(8) as any, source },
      create: { fromCode, toCode, rateDate: dayKey, rate: rate.toFixed(8) as any, source },
    });
  }
}
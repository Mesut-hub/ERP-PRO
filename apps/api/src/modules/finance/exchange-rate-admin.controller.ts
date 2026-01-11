import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { FxService } from './fx/fx.service';

@Controller('md/exchange-rates')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class ExchangeRateAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
  ) {}

  @Post()
  @RequirePermissions('md.exchange_rate.manage')
  async upsert(
    @Body() dto: { fromCode: string; toCode: string; rate: string; date: string; source?: string },
  ) {
    const fromCode = dto.fromCode.toUpperCase();
    const toCode = dto.toCode.toUpperCase();
    const rate = Number(dto.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid rate');

    const when = new Date(`${dto.date}T12:00:00.000Z`);
    const dayKey = this.fx.toIstanbulDayKey(when);

    const row = await this.prisma.exchangeRate.upsert({
      where: { fromCode_toCode_rateDate: { fromCode, toCode, rateDate: dayKey } },
      update: { rate: rate.toFixed(8) as any, source: dto.source ?? 'manual' },
      create: {
        fromCode,
        toCode,
        rateDate: dayKey,
        rate: rate.toFixed(8) as any,
        source: dto.source ?? 'manual',
      },
    });

    return { ok: true, id: row.id, fromCode, toCode, rateDate: dayKey.toISOString().slice(0, 10) };
  }
}

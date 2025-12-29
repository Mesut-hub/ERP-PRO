import { BadRequestException, Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../common/types/auth.types';
import { PrismaService } from '../prisma/prisma.service';

@Controller('fin')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class FinanceAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('periods')
  @RequirePermissions('fin.period.read')
  listPeriods() {
    return this.prisma.fiscalPeriod.findMany({ orderBy: { startDate: 'desc' }, take: 120 });
  }

  @Post('periods/close/:code')
  @RequirePermissions('fin.period.manage')
  async closePeriod(@CurrentUser() actor: JwtAccessPayload, @Param('code') code: string) {
    const period = await this.prisma.fiscalPeriod.findUnique({ where: { code } });
    if (!period) throw new BadRequestException('FiscalPeriod not found');
    if (period.status === 'CLOSED') return { ok: true };

    await this.prisma.fiscalPeriod.update({
      where: { code },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: actor.sub,
      },
    });

    return { ok: true };
  }

  @Post('periods/open/:code')
  @RequirePermissions('fin.period.manage')
  async openPeriod(@Param('code') code: string) {
    const period = await this.prisma.fiscalPeriod.findUnique({ where: { code } });
    if (!period) throw new BadRequestException('FiscalPeriod not found');

    await this.prisma.fiscalPeriod.update({
      where: { code },
      data: { status: 'OPEN', closedAt: null, closedById: null },
    });

    return { ok: true };
  }

  @Get('settings/posting-lock-date')
  @RequirePermissions('fin.period.read')
  async getPostingLockDate() {
    const lock = await this.prisma.systemSetting.findUnique({ where: { key: 'POSTING_LOCK_DATE' } });
    return { key: 'POSTING_LOCK_DATE', value: lock?.value ?? '1970-01-01' };
  }

  @Put('settings/posting-lock-date')
  @RequirePermissions('fin.period.manage')
  async setPostingLockDate(@Body() body: { value: string }) {
    if (!body?.value) throw new BadRequestException('value is required (YYYY-MM-DD)');
    // Minimal validation:
    const d = new Date(body.value);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date format');

    const updated = await this.prisma.systemSetting.upsert({
      where: { key: 'POSTING_LOCK_DATE' },
      update: { value: body.value },
      create: { key: 'POSTING_LOCK_DATE', value: body.value },
    });

    return { key: updated.key, value: updated.value };
  }
}
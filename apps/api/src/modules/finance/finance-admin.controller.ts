import { BadRequestException, Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../common/types/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';
import { PeriodActionDto } from './dto/period-action.dto';
import { SetPostingLockDateDto } from './dto/set-posting-lock-date.dto';

@Controller('fin')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class FinanceAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('periods')
  @RequirePermissions('fin.period.read')
  listPeriods() {
    return this.prisma.fiscalPeriod.findMany({ orderBy: { startDate: 'desc' }, take: 120 });
  }

  @Post('periods/close/:code')
  @RequirePermissions('fin.period.manage')
  async closePeriod(
    @CurrentUser() actor: JwtAccessPayload,
    @Param('code') code: string,
    @Body() dto: PeriodActionDto,
  ) {
    const period = await this.prisma.fiscalPeriod.findUnique({ where: { code } });
    if (!period) throw new BadRequestException('FiscalPeriod not found');

    if (period.status === 'CLOSED') return { ok: true };

    await this.prisma.fiscalPeriod.update({
      where: { code },
      data: { status: 'CLOSED', closedAt: new Date(), closedById: actor.sub },
    });

    await this.audit.log({
      actorId: actor.sub,
      action: AuditAction.UPDATE,
      entity: 'FiscalPeriod',
      entityId: period.id,
      after: { code, status: 'CLOSED', reason: dto.reason },
      message: `Closed fiscal period ${code}. Reason: ${dto.reason}`,
    });

    return { ok: true };
  }

  @Post('periods/open/:code')
  @RequirePermissions('fin.period.manage')
  async openPeriod(
    @CurrentUser() actor: JwtAccessPayload,
    @Param('code') code: string,
    @Body() dto: PeriodActionDto,
  ) {
    const period = await this.prisma.fiscalPeriod.findUnique({ where: { code } });
    if (!period) throw new BadRequestException('FiscalPeriod not found');

    await this.prisma.fiscalPeriod.update({
      where: { code },
      data: { status: 'OPEN', closedAt: null, closedById: null },
    });

    await this.audit.log({
      actorId: actor.sub,
      action: AuditAction.UPDATE,
      entity: 'FiscalPeriod',
      entityId: period.id,
      after: { code, status: 'OPEN', reason: dto.reason },
      message: `Re-opened fiscal period ${code}. Reason: ${dto.reason}`,
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
  async setPostingLockDate(
    @CurrentUser() actor: JwtAccessPayload,
    @Body() dto: SetPostingLockDateDto,
  ) {
    const d = new Date(dto.value);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date format');

    const updated = await this.prisma.systemSetting.upsert({
      where: { key: 'POSTING_LOCK_DATE' },
      update: { value: dto.value },
      create: { key: 'POSTING_LOCK_DATE', value: dto.value },
    });

    await this.audit.log({
      actorId: actor.sub,
      action: AuditAction.UPDATE,
      entity: 'SystemSetting',
      entityId: updated.key,
      after: { key: updated.key, value: updated.value, reason: dto.reason },
      message: `Updated POSTING_LOCK_DATE to ${updated.value}. Reason: ${dto.reason}`,
    });

    return { key: updated.key, value: updated.value };
  }
}
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@prisma/client';

@Injectable()
export class CurrenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.currency.findMany({ orderBy: { code: 'asc' } });
  }

  async setStatus(actorId: string, code: string, isActive: boolean) {
    const before = await this.prisma.currency.findUnique({ where: { code } });
    if (!before) throw new NotFoundException('Currency not found');

    if (before.isBase && !isActive) {
      throw new BadRequestException('Base currency cannot be deactivated');
    }

    const after = await this.prisma.currency.update({
      where: { code },
      data: { isActive },
    });

    await this.audit.log({
      actorId,
      action: AuditAction.UPDATE,
      entity: 'Currency',
      entityId: code,
      before: { isActive: before.isActive },
      after: { isActive: after.isActive },
      message: `Currency ${code} active=${isActive}`,
    });

    return after;
  }
}
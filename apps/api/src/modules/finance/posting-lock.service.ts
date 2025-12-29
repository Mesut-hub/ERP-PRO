import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAccessPayload } from '../../common/types/auth.types';

@Injectable()
export class PostingLockService {
  constructor(private readonly prisma: PrismaService) {}

  private has(actor: JwtAccessPayload, perm: string) {
    return (actor.permissions ?? []).includes(perm);
  }

  async assertPostingAllowed(actor: JwtAccessPayload, documentDate: Date, context: string) {
    // Override permission (admin-only)
    if (this.has(actor, 'fin.posting.override')) return;

    // 1) Global posting lock date
    const lock = await this.prisma.systemSetting.findUnique({ where: { key: 'POSTING_LOCK_DATE' } });
    if (lock) {
      const lockDate = new Date(lock.value);
      lockDate.setHours(23, 59, 59, 999);
      if (documentDate <= lockDate) {
        throw new ForbiddenException(`Posting locked on/before ${lock.value}. Context=${context}`);
      }
    }

    // 2) Closed fiscal period
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: {
        startDate: { lte: documentDate },
        endDate: { gte: documentDate },
      },
    });

    if (period && period.status === 'CLOSED') {
      throw new ForbiddenException(`Fiscal period ${period.code} is CLOSED. Context=${context}`);
    }
  }
}
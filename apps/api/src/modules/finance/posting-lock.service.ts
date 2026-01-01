import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAccessPayload } from '../../common/types/auth.types';

@Injectable()
export class PostingLockService {
  constructor(private readonly prisma: PrismaService) {}

  private has(actor: JwtAccessPayload, perm: string) {
    return (actor.permissions ?? []).includes(perm);
  }

  /**
   * If posting is blocked and actor has fin.posting.override, then overrideReason is REQUIRED.
   */
  async assertPostingAllowed(
    actor: JwtAccessPayload,
    documentDate: Date,
    context: string,
    overrideReason?: string,
  ) {
    const canOverride = this.has(actor, 'fin.posting.override');

    // Evaluate blocking conditions first (so we know whether override is actually used)
    let blockedMsg: string | null = null;

    // 1) Global lock date
    const lock = await this.prisma.systemSetting.findUnique({ where: { key: 'POSTING_LOCK_DATE' } });
    if (lock) {
      const lockDate = new Date(lock.value);
      lockDate.setHours(23, 59, 59, 999);
      if (documentDate <= lockDate) {
        blockedMsg = `Posting locked on/before ${lock.value}. Context=${context}`;
      }
    }

    // 2) Closed fiscal period
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: { startDate: { lte: documentDate }, endDate: { gte: documentDate } },
    });

    if (period && period.status === 'CLOSED') {
      blockedMsg = `Fiscal period ${period.code} is CLOSED. Context=${context}`;
    }

    // Not blocked => OK
    if (!blockedMsg) return;

    // Blocked => must override
    if (!canOverride) throw new ForbiddenException(blockedMsg);

    const clean = (overrideReason ?? '').trim();
    if (!clean || clean.length < 15) {
      throw new ForbiddenException(`Override reason is required to bypass posting locks. Context=${context}`);
    }

    // Allowed due to override, caller must audit it (we keep service pure: it only enforces)
    return;
  }
}
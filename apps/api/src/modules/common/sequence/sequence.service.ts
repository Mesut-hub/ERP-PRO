import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

function ymd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

@Injectable()
export class SequenceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomic increment. Returns the allocated number.
   * periodMode = 'DAY' gives periodKey=YYYYMMDD (recommended for your current formats)
   */
  async next(sequenceCode: string, date: Date, periodMode: 'DAY' | 'MONTH' = 'DAY') {
    const periodKey =
      periodMode === 'DAY'
        ? ymd(date)
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    // Transaction ensures correctness under concurrency
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.documentSequence.upsert({
        where: { sequenceCode_periodKey: { sequenceCode, periodKey } },
        update: { nextNumber: { increment: 1 } },
        create: { sequenceCode, periodKey, nextNumber: 2 },
      });

      // We return the number that was allocated *before* increment.
      // If row.nextNumber is now 2, allocated was 1.
      return row.nextNumber - 1;
    });
  }
}
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SequenceService {
  constructor(private readonly prisma: PrismaService) {}

  private periodKey(date: Date, granularity: 'DAY' | 'MONTH' | 'YEAR') {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');

    if (granularity === 'YEAR') return `${y}`;
    if (granularity === 'MONTH') return `${y}-${m}`;
    return `${y}${m}${d}`; // DAY => "20260103"
  }

  /**
   * Atomic increment. Returns the allocated number.
   * periodMode = 'DAY' gives periodKey=YYYYMMDD (recommended for your current formats)
   */
  async next(sequenceCode: string, documentDate: Date, granularity: 'DAY' | 'MONTH' | 'YEAR') {
    const code = (sequenceCode ?? '').trim().toUpperCase();
    if (!code) throw new Error('sequenceCode is required');

    const key = this.periodKey(documentDate, granularity);

    // Very strong safety: retry a few times if a concurrent transaction causes a unique conflict
    // (should be rare with row locking, but makes it bulletproof).
    const maxAttempts = 5;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // 1) Ensure row exists (upsert)
          await tx.documentSequence.upsert({
            where: { sequenceCode_periodKey: { sequenceCode: code, periodKey: key } },
            update: {},
            create: { sequenceCode: code, periodKey: key, nextNumber: 1 },
          });

          // 2) Lock row (Postgres row lock) so concurrent allocators wait
          // Prisma doesn't expose FOR UPDATE directly, so we use raw SQL.
          // This guarantees we don't allocate the same nextNumber twice.
          const rows: Array<{ id: string; nextNumber: number }> = await tx.$queryRawUnsafe(
            `SELECT "id", "nextNumber" FROM "DocumentSequence" WHERE "sequenceCode" = $1 AND "periodKey" = $2 FOR UPDATE`,
            code,
            key,
          );

          if (!rows.length) throw new Error('DocumentSequence row missing after upsert');

          const current = rows[0].nextNumber;

          // 3) Increment nextNumber
          await tx.documentSequence.update({
            where: { id: rows[0].id },
            data: { nextNumber: current + 1 },
          });

          // allocated number is the value we used
          return current;
        });
      } catch (e: any) {
        // Prisma unique conflict code
        if (e?.code === 'P2002' && attempt < maxAttempts) continue;
        throw e;
      }
    }

    // Should never hit
    throw new Error(`Failed to allocate sequence for ${sequenceCode}/${key}`);
  }
}
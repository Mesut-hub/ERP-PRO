import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JournalStatus } from '@prisma/client';

function parseYyyyMmDdAsDateStart(s: string): Date {
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date');
  return d;
}

function parseYyyyMmDdAsDateEnd(s: string): Date {
  const d = new Date(`${s}T23:59:59.999Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date');
  return d;
}

@Injectable()
export class AccountingReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async ledger(params: { accountCode: string; from?: string; to?: string }) {
    const acc = await this.prisma.account.findUnique({
      where: { code: params.accountCode },
      select: { id: true, code: true, name: true },
    });
    if (!acc) throw new BadRequestException(`Unknown accountCode ${params.accountCode}`);

    const whereEntry: any = { status: JournalStatus.POSTED };

    if (params.from)
      whereEntry.documentDate = {
        ...(whereEntry.documentDate ?? {}),
        gte: parseYyyyMmDdAsDateStart(params.from),
      };
    if (params.to)
      whereEntry.documentDate = {
        ...(whereEntry.documentDate ?? {}),
        lte: parseYyyyMmDdAsDateEnd(params.to),
      };

    const lines = await this.prisma.journalLine.findMany({
      where: {
        accountId: acc.id,
        entry: whereEntry,
      },
      include: {
        entry: {
          select: {
            id: true,
            documentNo: true,
            documentDate: true,
            description: true,
            sourceType: true,
            sourceId: true,
          },
        },
        party: { select: { id: true, name: true } },
        account: { select: { code: true, name: true } },
      },
      orderBy: [
        { entry: { documentDate: 'asc' } },
        { entry: { documentNo: 'asc' } },
        { id: 'asc' },
      ],
    });

    // Optional: running balance (debit - credit)
    let running = 0;
    const data = lines.map((l) => {
      const debit = Number(l.debit);
      const credit = Number(l.credit);
      running += debit - credit;

      return {
        journalEntry: l.entry,
        line: {
          id: l.id,
          description: l.description,
          debit,
          credit,
          currencyCode: l.currencyCode,
          amountCurrency: l.amountCurrency ? Number(l.amountCurrency) : null,
        },
        party: l.party,
        account: l.account,
        runningBalance: Number(running.toFixed(2)),
      };
    });

    return { account: acc, rows: data };
  }

  async trialBalance(params: { from?: string; to?: string }) {
    const whereEntry: any = { status: JournalStatus.POSTED };

    if (params.from)
      whereEntry.documentDate = {
        ...(whereEntry.documentDate ?? {}),
        gte: parseYyyyMmDdAsDateStart(params.from),
      };
    if (params.to)
      whereEntry.documentDate = {
        ...(whereEntry.documentDate ?? {}),
        lte: parseYyyyMmDdAsDateEnd(params.to),
      };

    // Fetch lines with accounts and aggregate in memory (simple & correct).
    // If volume grows, we can switch to raw SQL GROUP BY for speed.
    const lines = await this.prisma.journalLine.findMany({
      where: { entry: whereEntry },
      include: { account: { select: { id: true, code: true, name: true, type: true } } },
      orderBy: [{ accountId: 'asc' }],
    });

    const byAcc = new Map<
      string,
      { code: string; name: string; type: string; debit: number; credit: number }
    >();

    for (const l of lines) {
      const key = l.account.id;
      const item = byAcc.get(key) ?? {
        code: l.account.code,
        name: l.account.name,
        type: l.account.type,
        debit: 0,
        credit: 0,
      };

      item.debit += Number(l.debit);
      item.credit += Number(l.credit);

      byAcc.set(key, item);
    }

    const rows = Array.from(byAcc.values())
      .map((r) => ({
        accountCode: r.code,
        accountName: r.name,
        accountType: r.type,
        debit: Number(r.debit.toFixed(2)),
        credit: Number(r.credit.toFixed(2)),
        net: Number((r.debit - r.credit).toFixed(2)),
      }))
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    return { rows };
  }
}

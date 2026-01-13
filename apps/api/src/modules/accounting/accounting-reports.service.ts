import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountType, JournalStatus } from '@prisma/client';

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

function toInt(v: any, def: number): number {
  if (v === undefined || v === null || v === '') return def;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

@Injectable()
export class AccountingReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async ledger(params: {
    accountCode: string;
    from?: string;
    to?: string;
    sourceType?: string;
    partyId?: string;
    skip?: number;
    take?: number;
  }) {
    const acc = await this.prisma.account.findUnique({
      where: { code: params.accountCode },
      select: { id: true, code: true, name: true },
    });
    if (!acc) throw new BadRequestException(`Unknown accountCode ${params.accountCode}`);

    const skip = Math.max(0, toInt(params.skip as any, 0));
    const take = Math.min(1000, Math.max(1, toInt(params.take as any, 200)));

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
    if (params.sourceType) whereEntry.sourceType = params.sourceType;

    const whereLine: any = {
      accountId: acc.id,
      entry: whereEntry,
    };

    if (params.partyId) whereLine.partyId = params.partyId;

    const total = await this.prisma.journalLine.count({ where: whereLine });

    const lines = await this.prisma.journalLine.findMany({
      where: whereLine,
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
      orderBy: [{ entry: { documentDate: 'asc' } }, { entry: { documentNo: 'asc' } }, { id: 'asc' }],
      skip,
      take,
    });

    // Running balance within the returned page (not global running across all pages).
    // Cursor-based pagination later can support stable global running if needed.
    let running = 0;
    const rows = lines.map((l) => {
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

    return {
      account: acc,
      meta: {
        skip,
        take,
        total,
        // cursor later:
        // nextCursor: null
      },
      rows,
    };
  }

  async trialBalance(params: {
    from?: string;
    to?: string;
    accountType?: AccountType;
    onlyNonZero?: boolean;
  }) {
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

    const whereLine: any = { entry: whereEntry };

    if (params.accountType) {
      whereLine.account = { type: params.accountType };
    }

    const lines = await this.prisma.journalLine.findMany({
      where: whereLine,
      include: { account: { select: { id: true, code: true, name: true, type: true } } },
      orderBy: [{ accountId: 'asc' }],
    });

    const byAcc = new Map<
      string,
      { code: string; name: string; type: string; debit: number; credit: number }
    >();

    for (const l of lines) {
      const key = l.account.id;
      const item =
        byAcc.get(key) ??
        {
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

    let rows = Array.from(byAcc.values()).map((r) => ({
      accountCode: r.code,
      accountName: r.name,
      accountType: r.type,
      debit: Number(r.debit.toFixed(2)),
      credit: Number(r.credit.toFixed(2)),
      net: Number((r.debit - r.credit).toFixed(2)),
    }));

    if (params.onlyNonZero) {
      rows = rows.filter((r) => Math.abs(r.net) > 0.0000001);
    }

    rows.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    return { rows };
  }

  async grni(params: { from?: string; to?: string; supplierId?: string; onlyNonZero?: boolean }) {
    const acc = await this.prisma.account.findUnique({
      where: { code: '327' },
      select: { id: true, code: true, name: true },
    });
    if (!acc) throw new BadRequestException('GRNI account 327 not found');

    // Defaults (v1.1)
    const today = new Date();
    const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1, 0, 0, 0, 0));

    const fromDate = params.from ? parseYyyyMmDdAsDateStart(params.from) : yearStart;
    const toDate = params.to ? parseYyyyMmDdAsDateEnd(params.to) : today;

    const whereEntry: any = {
      status: JournalStatus.POSTED,
      documentDate: { gte: fromDate, lte: toDate },
    };

    const whereLine: any = {
      accountId: acc.id,
      entry: whereEntry,
    };

    if (params.supplierId) whereLine.partyId = params.supplierId;

    const lines = await this.prisma.journalLine.findMany({
      where: whereLine,
      select: {
        debit: true,
        credit: true,
        partyId: true,
        party: { select: { id: true, name: true } },
      },
    });

    const byParty = new Map<
      string,
      { partyId: string; partyName: string | null; debit: number; credit: number }
    >();

    for (const l of lines) {
      const partyId = l.partyId ?? '(no-party)';
      const item =
        byParty.get(partyId) ?? {
          partyId,
          partyName: l.party?.name ?? null,
          debit: 0,
          credit: 0,
        };

      item.debit += Number(l.debit);
      item.credit += Number(l.credit);

      if (!item.partyName && l.party?.name) item.partyName = l.party.name;

      byParty.set(partyId, item);
    }

    const onlyNonZero = params.onlyNonZero ?? true;

    let rows = Array.from(byParty.values()).map((r) => {
      const debit = Number(r.debit.toFixed(2));
      const credit = Number(r.credit.toFixed(2));
      const net = Number((debit - credit).toFixed(2));

      return {
        supplierId: r.partyId === '(no-party)' ? null : r.partyId,
        supplierName: r.partyName,
        debit,
        credit,
        net,
      };
    });

    if (onlyNonZero) {
      rows = rows.filter((r) => Math.abs(r.net) > 0.0000001);
    }

    // Sort by absolute net desc (largest reconciliation differences first)
    rows.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

    return {
      account: acc,
      meta: {
        from: fromDate.toISOString().slice(0, 10),
        to: toDate.toISOString().slice(0, 10),
        onlyNonZero,
      },
      rows,
    };
  }
}
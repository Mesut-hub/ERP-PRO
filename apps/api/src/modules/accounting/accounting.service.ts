import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, JournalStatus } from '@prisma/client';
import { formatJeNo } from './docno';
import { PostingLockService } from '../finance/posting-lock.service';
import { JwtAccessPayload } from '../../common/types/auth.types';
import { DocNoService } from '../common/sequence/docno.service';

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

@Injectable()
export class AccountingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly postingLock: PostingLockService,
    private readonly docNo: DocNoService,
  ) {}

  async listAccounts() {
    return this.prisma.account.findMany({ orderBy: { code: 'asc' } });
  }

  async listJournalEntries() {
    return this.prisma.journalEntry.findMany({
      orderBy: { createdAt: 'desc' },
      include: { lines: { include: { account: true } } },
      take: 100,
    });
  }

  /*private async nextJeNo(date: Date) {
    const count = await this.prisma.journalEntry.count({
      where: { documentDate: { gte: startOfDay(date), lte: endOfDay(date) } },
    });
    return formatJeNo(date, count + 1);
  }*/

  private validateBalanced(lines: Array<{ debit: string; credit: string }>) {
    const debit = lines.reduce((s, l) => s + Number(l.debit), 0);
    const credit = lines.reduce((s, l) => s + Number(l.credit), 0);
    if (Math.abs(debit - credit) > 0.005) {
      throw new BadRequestException(`Journal not balanced. debit=${debit}, credit=${credit}`);
    }
  }

  async createJournal(actorId: string, dto: any) {
    if (!dto.lines || dto.lines.length < 2) throw new BadRequestException('Journal must have at least 2 lines');

    // Validate accounts exist
    for (const l of dto.lines) {
      const a = await this.prisma.account.findUnique({ where: { id: l.accountId } });
      if (!a) throw new BadRequestException('Invalid accountId');
      if (Number(l.debit) < 0 || Number(l.credit) < 0) throw new BadRequestException('Negative amounts not allowed');
      if (Number(l.debit) > 0 && Number(l.credit) > 0) throw new BadRequestException('Line cannot have both debit and credit');
    }

    this.validateBalanced(dto.lines);

    const docDate = dto.documentDate ? new Date(dto.documentDate) : new Date();
    const docNo = await this.docNo.allocate('JE', docDate);

    const created = await this.prisma.journalEntry.create({
      data: {
        status: JournalStatus.DRAFT,
        documentNo: docNo,
        documentDate: docDate,
        description: dto.description,
        sourceType: dto.sourceType ?? null,
        sourceId: dto.sourceId ?? null,
        createdById: actorId,
        lines: {
          create: dto.lines.map((l: any) => ({
            accountId: l.accountId,
            partyId: l.partyId ?? null,
            description: l.description,
            debit: l.debit,
            credit: l.credit,
            currencyCode: l.currencyCode ?? null,
            amountCurrency: l.amountCurrency ?? null,
          })),
        },
      },
      include: { lines: true },
    });

    await this.audit.log({
      actorId,
      action: AuditAction.CREATE,
      entity: 'JournalEntry',
      entityId: created.id,
      after: { documentNo: created.documentNo, status: created.status },
      message: `Created JE ${created.documentNo}`,
    });

    return created;
  }

  async postJournal(actor: JwtAccessPayload, id: string) {
    const je = await this.prisma.journalEntry.findUnique({ where: { id }, include: { lines: true } });
    if (!je) throw new NotFoundException('JournalEntry not found');
    if (je.status !== JournalStatus.DRAFT) throw new BadRequestException('Only DRAFT journals can be posted');

    await this.postingLock.assertPostingAllowed(actor, je.documentDate, `Accounting.postJournal journalId=${je.id}`);
    this.validateBalanced(je.lines.map((l) => ({ debit: l.debit.toString(), credit: l.credit.toString() })));

    const updated = await this.prisma.journalEntry.update({
      where: { id },
      data: { status: JournalStatus.POSTED, postedAt: new Date(), postedById: actor.sub },
    });

    await this.audit.log({
      actorId: actor.sub,
      action: AuditAction.POST,
      entity: 'JournalEntry',
      entityId: id,
      after: { status: updated.status, postedAt: updated.postedAt },
      message: `Posted JE ${je.documentNo}`,
    });

    return { ok: true };
  }

  /**
   * Centralized integration helper (Purchasing/Sales/Payments should use this).
   * Creates a JE already POSTED and returns it.
   */
  async createPostedFromIntegration(actorId: string, input: {
    documentDate: Date;
    description: string;
    sourceType: string;
    sourceId: string;
    lines: Array<{
      accountId: string;
      partyId?: string | null;
      description?: string;
      debit: string;
      credit: string;
      currencyCode?: string | null;
      amountCurrency?: string | null;
    }>;
  }) {
    if (!input.lines || input.lines.length < 2) throw new BadRequestException('Journal must have at least 2 lines');
    this.validateBalanced(input.lines);

    const docNo = await this.docNo.allocate('JE', input.documentDate);

    const je = await this.prisma.journalEntry.create({
      data: {
        status: 'POSTED',
        documentNo: docNo,
        documentDate: input.documentDate,
        description: input.description,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        createdById: actorId,
        postedById: actorId,
        postedAt: new Date(),
        lines: { create: input.lines.map((l) => ({ ...l, partyId: l.partyId ?? null })) },
      },
    });

    await this.audit.log({
      actorId,
      action: AuditAction.POST,
      entity: 'JournalEntry',
      entityId: je.id,
      after: { documentNo: je.documentNo, sourceType: je.sourceType, sourceId: je.sourceId },
      message: `Auto-posted JE ${je.documentNo} from ${input.sourceType}`,
    });

    return je;
  }
}
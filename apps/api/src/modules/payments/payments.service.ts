import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  PartyType,
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';
import { JwtAccessPayload } from '../../common/types/auth.types';
import { AuditService } from '../audit/audit.service';
import { AccountingService } from '../accounting/accounting.service';
import { DocNoService } from '../common/sequence/docno.service';
import { PostingLockService } from '../finance/posting-lock.service';
import { PrismaService } from '../prisma/prisma.service';
import { VoidPaymentDto } from './dto/void-payment.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly postingLock: PostingLockService,
    private readonly docNo: DocNoService,
    private readonly accounting: AccountingService,
  ) {}

  private has(actor: JwtAccessPayload, perm: string) {
    return (actor.permissions ?? []).includes(perm);
  }

  list() {
    return this.prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      include: { party: true, currency: true, allocations: true },
      take: 100,
    });
  }

  private validateAllocations(direction: PaymentDirection, allocations: any[] | undefined) {
    if (!allocations || allocations.length === 0) return;

    for (const a of allocations) {
      const hasCustomer = !!a.customerInvoiceId;
      const hasSupplier = !!a.supplierInvoiceId;
      if (hasCustomer === hasSupplier) {
        throw new BadRequestException(
          'Each allocation must have exactly one of customerInvoiceId or supplierInvoiceId',
        );
      }
      if (Number(a.amount) <= 0) throw new BadRequestException('Allocation amount must be > 0');

      if (direction === PaymentDirection.IN && !hasCustomer) {
        throw new BadRequestException('IN payment allocations must target customer invoices');
      }
      if (direction === PaymentDirection.OUT && !hasSupplier) {
        throw new BadRequestException('OUT payment allocations must target supplier invoices');
      }
    }
  }

  private async getOpenAmountCustomerInvoice(customerInvoiceId: string) {
    const inv = await this.prisma.customerInvoice.findUnique({ where: { id: customerInvoiceId } });
    if (!inv) throw new BadRequestException('Invalid customerInvoiceId');

    const alloc = await this.prisma.paymentAllocation.aggregate({
      where: { customerInvoiceId, payment: { status: 'POSTED' } },
      _sum: { amount: true },
    });

    const paid = Number(alloc._sum.amount ?? 0);
    const open = Number(inv.grandTotal) - paid;
    return { inv, open };
  }

  private async getOpenAmountSupplierInvoice(supplierInvoiceId: string) {
    const inv = await this.prisma.supplierInvoice.findUnique({ where: { id: supplierInvoiceId } });
    if (!inv) throw new BadRequestException('Invalid supplierInvoiceId');

    const alloc = await this.prisma.paymentAllocation.aggregate({
      where: { supplierInvoiceId, payment: { status: 'POSTED' } },
      _sum: { amount: true },
    });

    const paid = Number(alloc._sum.amount ?? 0);
    const open = Number(inv.grandTotal) - paid;
    return { inv, open };
  }

  async create(actor: JwtAccessPayload, dto: any) {
    const amount = Number(dto.amount);
    if (amount <= 0) throw new BadRequestException('amount must be > 0');

    const party = await this.prisma.party.findUnique({ where: { id: dto.partyId } });
    if (!party) throw new BadRequestException('Invalid partyId');

    // Direction must match party type (strict)
    if (dto.direction === PaymentDirection.IN && party.type !== PartyType.CUSTOMER) {
      throw new BadRequestException('IN payment requires CUSTOMER party');
    }
    if (dto.direction === PaymentDirection.OUT && party.type !== PartyType.SUPPLIER) {
      throw new BadRequestException('OUT payment requires SUPPLIER party');
    }

    const cur = await this.prisma.currency.findUnique({
      where: { code: dto.currencyCode.toUpperCase() },
    });
    if (!cur || !cur.isActive) throw new BadRequestException('Invalid currencyCode');

    this.validateAllocations(dto.direction, dto.allocations);

    // If allocations exist they must sum to amount
    if (dto.allocations?.length) {
      const sumAlloc = dto.allocations.reduce((s: number, a: any) => s + Number(a.amount), 0);
      if (Math.abs(sumAlloc - amount) > 0.005) {
        throw new BadRequestException(
          `Allocations must sum to payment amount. alloc=${sumAlloc}, amount=${amount}`,
        );
      }
    }

    // Allocation validation:
    const allowDraftAlloc = this.has(actor, 'pay.allocation.draft.override');

    if (dto.allocations?.length) {
      for (const a of dto.allocations) {
        if (a.customerInvoiceId) {
          const { inv, open } = await this.getOpenAmountCustomerInvoice(a.customerInvoiceId);

          if (inv.customerId !== dto.partyId)
            throw new BadRequestException('Customer invoice does not belong to this party');

          if (inv.status !== 'POSTED' && !allowDraftAlloc) {
            throw new ForbiddenException(
              'Allocations to DRAFT customer invoices require admin override permission',
            );
          }

          // Only enforce open-amount rule for POSTED invoices (draft can change)
          if (inv.status === 'POSTED' && Number(a.amount) > open + 0.005) {
            throw new BadRequestException(
              `Allocation exceeds open amount for invoice ${inv.documentNo}`,
            );
          }
        }

        if (a.supplierInvoiceId) {
          const { inv, open } = await this.getOpenAmountSupplierInvoice(a.supplierInvoiceId);

          if (inv.supplierId !== dto.partyId)
            throw new BadRequestException('Supplier invoice does not belong to this party');

          if (inv.status !== 'POSTED' && !allowDraftAlloc) {
            throw new ForbiddenException(
              'Allocations to DRAFT supplier invoices require admin override permission',
            );
          }

          if (inv.status === 'POSTED' && Number(a.amount) > open + 0.005) {
            throw new BadRequestException(
              `Allocation exceeds open amount for invoice ${inv.documentNo}`,
            );
          }
        }
      }
    }

    const docDate = dto.documentDate ? new Date(dto.documentDate) : new Date();
    const docNo = await this.docNo.allocate('PAY', docDate);

    const created = await this.prisma.payment.create({
      data: {
        status: PaymentStatus.DRAFT,
        documentNo: docNo,
        documentDate: docDate,
        direction: dto.direction,
        method: dto.method,
        partyId: dto.partyId,
        notes: dto.notes,
        currencyCode: cur.code,
        exchangeRateToBase: dto.exchangeRateToBase ?? null,
        amount: dto.amount,
        createdById: actor.sub,
        allocations: dto.allocations?.length
          ? {
              create: dto.allocations.map((x: any) => ({
                customerInvoiceId: x.customerInvoiceId ?? null,
                supplierInvoiceId: x.supplierInvoiceId ?? null,
                amount: x.amount,
              })),
            }
          : undefined,
      },
      include: { allocations: true },
    });

    await this.audit.log({
      actorId: actor.sub,
      action: AuditAction.CREATE,
      entity: 'Payment',
      entityId: created.id,
      after: { documentNo: created.documentNo, status: created.status, amount: created.amount },
      message: `Created payment ${created.documentNo}`,
    });

    return created;
  }

  async post(actor: JwtAccessPayload, id: string, overrideReason?: string) {
    const pay = await this.prisma.payment.findUnique({
      where: { id },
      include: { party: true, allocations: true },
    });
    if (!pay) throw new NotFoundException('Payment not found');
    if (pay.status !== PaymentStatus.DRAFT)
      throw new BadRequestException('Only DRAFT payments can be posted');

    await this.postingLock.assertPostingAllowed(
      actor,
      pay.documentDate,
      `Payments.post paymentId=${pay.id}`,
      overrideReason,
    );

    // Allocations must sum to amount (if allocations exist)
    if (pay.allocations.length) {
      const sumAlloc = pay.allocations.reduce((s, a) => s + Number(a.amount), 0);
      if (Math.abs(sumAlloc - Number(pay.amount)) > 0.005) {
        throw new BadRequestException('Allocations must sum to payment amount');
      }
    }

    // Enforce invoice status on POST:
    if (pay.allocations.length) {
      const allowDraftOnPost = this.has(actor, 'pay.post.draft_allocations.override');

      for (const a of pay.allocations) {
        if (a.customerInvoiceId) {
          const inv = await this.prisma.customerInvoice.findUnique({
            where: { id: a.customerInvoiceId },
          });
          if (!inv) throw new BadRequestException('Invalid customerInvoiceId in allocations');

          if (inv.status !== 'POSTED' && !allowDraftOnPost) {
            throw new ForbiddenException(
              'Posting payment with allocations to DRAFT customer invoices requires admin override',
            );
          }
        }
        if (a.supplierInvoiceId) {
          const inv = await this.prisma.supplierInvoice.findUnique({
            where: { id: a.supplierInvoiceId },
          });
          if (!inv) throw new BadRequestException('Invalid supplierInvoiceId in allocations');

          if (inv.status !== 'POSTED' && !allowDraftOnPost) {
            throw new ForbiddenException(
              'Posting payment with allocations to DRAFT supplier invoices requires admin override',
            );
          }
        }
      }
    }

    // Required accounts
    const accCash = await this.prisma.account.findUnique({ where: { code: '100' } });
    const accBank = await this.prisma.account.findUnique({ where: { code: '102' } });
    const accAR = await this.prisma.account.findUnique({ where: { code: '120' } });
    const accAP = await this.prisma.account.findUnique({ where: { code: '320' } });

    if (!accCash || !accBank || !accAR || !accAP) {
      throw new BadRequestException('Missing required accounts (100, 102, 120, 320)');
    }

    const assetAccountId = pay.method === PaymentMethod.CASH ? accCash.id : accBank.id;
    const amount = Number(pay.amount);

    const journalLines: any[] = [];

    if (pay.direction === PaymentDirection.IN) {
      // Debit Cash/Bank, Credit AR
      journalLines.push({
        accountId: assetAccountId,
        partyId: pay.partyId,
        description: `Payment IN ${pay.documentNo}`,
        debit: amount.toFixed(2),
        credit: '0',
        currencyCode: pay.currencyCode,
        amountCurrency: amount.toFixed(2),
      });
      journalLines.push({
        accountId: accAR.id,
        partyId: pay.partyId,
        description: `AR settlement ${pay.party.name} (${pay.documentNo})`,
        debit: '0',
        credit: amount.toFixed(2),
        currencyCode: pay.currencyCode,
        amountCurrency: amount.toFixed(2),
      });
    } else {
      // Debit AP, Credit Cash/Bank
      journalLines.push({
        accountId: accAP.id,
        partyId: pay.partyId,
        description: `AP settlement ${pay.party.name} (${pay.documentNo})`,
        debit: amount.toFixed(2),
        credit: '0',
        currencyCode: pay.currencyCode,
        amountCurrency: amount.toFixed(2),
      });
      journalLines.push({
        accountId: assetAccountId,
        partyId: pay.partyId,
        description: `Payment OUT ${pay.documentNo}`,
        debit: '0',
        credit: amount.toFixed(2),
        currencyCode: pay.currencyCode,
        amountCurrency: amount.toFixed(2),
      });
    }

    // Balanced check
    const debit = journalLines.reduce((s, l) => s + Number(l.debit), 0);
    const credit = journalLines.reduce((s, l) => s + Number(l.credit), 0);
    if (Math.abs(debit - credit) > 0.005)
      throw new BadRequestException('Payment journal not balanced');

    // Transaction: mark payment posted then create JE via AccountingService (which uses DocumentSequence)
    const payPosted = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.payment.findUnique({ where: { id } });
      if (!locked) throw new NotFoundException('Payment not found');
      if (locked.status !== PaymentStatus.DRAFT)
        throw new BadRequestException('Already posted/canceled');

      return tx.payment.update({
        where: { id },
        data: { status: PaymentStatus.POSTED, postedAt: new Date(), postedById: actor.sub },
      });
    });

    // Create JE through AccountingService (sequence-safe, centralized)
    let je;
    try {
      je = await this.accounting.createPostedFromIntegration(actor.sub, {
        documentDate: pay.documentDate, // important: use payment's document date
        description: `Payment ${pay.documentNo} posting`,
        sourceType: 'Payment',
        sourceId: pay.id,
        lines: journalLines,
      });
    } catch (e) {
      // Compensation (recommended): revert payment back to DRAFT if JE creation fails
      await this.prisma.payment.update({
        where: { id },
        data: { status: PaymentStatus.DRAFT, postedAt: null, postedById: null },
      });
      throw e;
    }

    await this.audit.log({
      actorId: actor.sub,
      action: AuditAction.POST,
      entity: 'Payment',
      entityId: id,
      after: { status: payPosted.status, journalEntryId: je.id },
      message: overrideReason
        ? `Posted payment ${pay.documentNo} (override reason: ${overrideReason}) and created JE ${je.documentNo}`
        : `Posted payment ${pay.documentNo} and created JE ${je.documentNo}`,
    });

    return { ok: true, journalEntryId: je.id };
  }

  // ... inside class
  async voidPayment(actor: JwtAccessPayload, id: string, dto: VoidPaymentDto) {
    const original = await this.prisma.payment.findUnique({
      where: { id },
      include: { allocations: true, party: true },
    });
    if (!original) throw new NotFoundException('Payment not found');
    if (original.status !== 'POSTED')
      throw new BadRequestException('Only POSTED payments can be voided');

    const existingVoid = await this.prisma.payment.findFirst({ where: { voidOfId: original.id } });
    if (existingVoid) throw new BadRequestException('Payment already voided');

    const voidDate = new Date(dto.documentDate);

    // Lock rules apply to the void document date
    await this.postingLock.assertPostingAllowed(
      actor,
      voidDate,
      `Payments.void paymentId=${original.id}`,
      dto.reason,
    );

    // Build void payment direction:
    // - IN void => OUT (returns money)
    // - OUT void => IN
    const voidDirection = original.direction === 'IN' ? 'OUT' : 'IN';

    const voidDocNo = await this.docNo.allocate('PAY', voidDate);

    // Required accounts
    const accCash = await this.prisma.account.findUnique({ where: { code: '100' } });
    const accBank = await this.prisma.account.findUnique({ where: { code: '102' } });
    const accAR = await this.prisma.account.findUnique({ where: { code: '120' } });
    const accAP = await this.prisma.account.findUnique({ where: { code: '320' } });
    if (!accCash || !accBank || !accAR || !accAP) {
      throw new BadRequestException('Missing required accounts (100, 102, 120, 320)');
    }

    const assetAccountId = original.method === 'CASH' ? accCash.id : accBank.id;
    const amount = Number(original.amount);

    // Build reversal JE lines (exact opposite of original’s posting)
    const journalLines: any[] = [];
    if (original.direction === 'IN') {
      // Original IN: Dr Cash, Cr AR  => Void must: Dr AR, Cr Cash
      journalLines.push({
        accountId: accAR.id,
        partyId: original.partyId,
        description: `VOID AR restore ${original.party.name} (${original.documentNo})`,
        debit: amount.toFixed(2),
        credit: '0',
        currencyCode: original.currencyCode,
        amountCurrency: amount.toFixed(2),
      });
      journalLines.push({
        accountId: assetAccountId,
        partyId: original.partyId,
        description: `VOID Payment IN ${original.documentNo}`,
        debit: '0',
        credit: amount.toFixed(2),
        currencyCode: original.currencyCode,
        amountCurrency: amount.toFixed(2),
      });
    } else {
      // Original OUT: Dr AP, Cr Cash  => Void must: Dr Cash, Cr AP
      journalLines.push({
        accountId: assetAccountId,
        partyId: original.partyId,
        description: `VOID Payment OUT ${original.documentNo}`,
        debit: amount.toFixed(2),
        credit: '0',
        currencyCode: original.currencyCode,
        amountCurrency: amount.toFixed(2),
      });
      journalLines.push({
        accountId: accAP.id,
        partyId: original.partyId,
        description: `VOID AP restore ${original.party.name} (${original.documentNo})`,
        debit: '0',
        credit: amount.toFixed(2),
        currencyCode: original.currencyCode,
        amountCurrency: amount.toFixed(2),
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      // Create void payment as POSTED directly (professional: void is an accounting event)
      const voidPay = await tx.payment.create({
        data: {
          status: 'POSTED',
          documentNo: voidDocNo,
          documentDate: voidDate,
          direction: voidDirection as any,
          method: original.method as any,
          partyId: original.partyId,
          notes: `VOID of ${original.documentNo}. ${dto.reason}`,
          currencyCode: original.currencyCode,
          exchangeRateToBase: original.exchangeRateToBase,
          amount: original.amount,
          createdById: actor.sub,
          postedById: actor.sub,
          postedAt: new Date(),

          voidOfId: original.id,

          allocations: original.allocations.length
            ? {
                create: original.allocations.map((a) => ({
                  customerInvoiceId: a.customerInvoiceId,
                  supplierInvoiceId: a.supplierInvoiceId,
                  amount: a.amount,
                })),
              }
            : undefined,
        },
      });

      // Mark original as voided (still POSTED, but now flagged)
      await tx.payment.update({
        where: { id: original.id },
        data: {
          voidedAt: new Date(),
          voidedById: actor.sub,
          voidReason: dto.reason,
        },
      });

      return voidPay;
    });

    // Post JE for the void payment using centralized accounting integration
    const je = await this.accounting.createPostedFromIntegration(actor.sub, {
      documentDate: voidDate,
      description: `Void payment ${created.documentNo} (void of ${original.documentNo})`,
      sourceType: 'PaymentVoid',
      sourceId: created.id,
      lines: journalLines,
    });

    await this.audit.log({
      actorId: actor.sub,
      action: 'POST' as any,
      entity: 'Payment',
      entityId: created.id,
      after: { voidOfId: original.id, journalEntryId: je.id, reason: dto.reason },
      message: `Voided payment ${original.documentNo} with ${created.documentNo}. Reason: ${dto.reason}`,
    });

    return {
      ok: true,
      voidPaymentId: created.id,
      voidDocumentNo: created.documentNo,
      journalEntryId: je.id,
    };
  }
}

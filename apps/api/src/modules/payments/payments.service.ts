import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  AuditAction,
  PartyType,
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';
import { formatPayNo } from './docno';
import { JwtAccessPayload } from '../../common/types/auth.types';
import { PostingLockService } from '../finance/posting-lock.service';

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
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly postingLock: PostingLockService,
  ) {}

  private has(actor: JwtAccessPayload, perm: string) {
    return (actor.permissions ?? []).includes(perm);
  }

  private async nextPayNo(date: Date) {
    const count = await this.prisma.payment.count({
      where: { documentDate: { gte: startOfDay(date), lte: endOfDay(date) } },
    });
    return formatPayNo(date, count + 1);
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
        throw new BadRequestException('Each allocation must have exactly one of customerInvoiceId or supplierInvoiceId');
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

    const cur = await this.prisma.currency.findUnique({ where: { code: dto.currencyCode.toUpperCase() } });
    if (!cur || !cur.isActive) throw new BadRequestException('Invalid currencyCode');

    this.validateAllocations(dto.direction, dto.allocations);

    // If allocations exist they must sum to amount
    if (dto.allocations?.length) {
      const sumAlloc = dto.allocations.reduce((s: number, a: any) => s + Number(a.amount), 0);
      if (Math.abs(sumAlloc - amount) > 0.005) {
        throw new BadRequestException(`Allocations must sum to payment amount. alloc=${sumAlloc}, amount=${amount}`);
      }
    }

    // Allocation validation:
    // - invoice belongs to party
    // - invoice status must be POSTED unless admin override
    // - allocation amount must be <= invoice open amount
    const allowDraftAlloc = this.has(actor, 'pay.allocation.draft.override');

    if (dto.allocations?.length) {
      for (const a of dto.allocations) {
        if (a.customerInvoiceId) {
          const { inv, open } = await this.getOpenAmountCustomerInvoice(a.customerInvoiceId);

          if (inv.customerId !== dto.partyId) throw new BadRequestException('Customer invoice does not belong to this party');

          if (inv.status !== 'POSTED' && !allowDraftAlloc) {
            throw new ForbiddenException('Allocations to DRAFT customer invoices require admin override permission');
          }

          if (Number(a.amount) > open + 0.005 && inv.status === 'POSTED') {
            throw new BadRequestException(`Allocation exceeds open amount for invoice ${inv.documentNo}`);
          }
        }

        if (a.supplierInvoiceId) {
          const { inv, open } = await this.getOpenAmountSupplierInvoice(a.supplierInvoiceId);

          if (inv.supplierId !== dto.partyId) throw new BadRequestException('Supplier invoice does not belong to this party');

          if (inv.status !== 'POSTED' && !allowDraftAlloc) {
            throw new ForbiddenException('Allocations to DRAFT supplier invoices require admin override permission');
          }

          if (Number(a.amount) > open + 0.005 && inv.status === 'POSTED') {
            throw new BadRequestException(`Allocation exceeds open amount for invoice ${inv.documentNo}`);
          }
        }
      }
    }

    const docDate = dto.documentDate ? new Date(dto.documentDate) : new Date();
    const docNo = await this.nextPayNo(docDate);

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

  async post(actor: JwtAccessPayload, id: string) {
    const pay = await this.prisma.payment.findUnique({
      where: { id },
      include: { party: true, allocations: true },
    });
    if (!pay) throw new NotFoundException('Payment not found');
    if (pay.status !== PaymentStatus.DRAFT) throw new BadRequestException('Only DRAFT payments can be posted');

    await this.postingLock.assertPostingAllowed(actor, pay.documentDate, `Payments.post paymentId=${pay.id}`);
    // Allocations must sum to amount (if allocations exist)
    if (pay.allocations.length) {
      const sumAlloc = pay.allocations.reduce((s, a) => s + Number(a.amount), 0);
      if (Math.abs(sumAlloc - Number(pay.amount)) > 0.005) {
        throw new BadRequestException('Allocations must sum to payment amount');
      }
    }

    // If allocations exist, enforce invoice status:
    // - default: only POSTED invoices can be referenced by a POSTED payment
    // - admin exception: requires pay.post.draft_allocations.override
    if (pay.allocations.length) {
      const allowDraftOnPost = this.has(actor, 'pay.post.draft_allocations.override');

      for (const a of pay.allocations) {
        if (a.customerInvoiceId) {
          const inv = await this.prisma.customerInvoice.findUnique({ where: { id: a.customerInvoiceId } });
          if (!inv) throw new BadRequestException('Invalid customerInvoiceId in allocations');

          if (inv.status !== 'POSTED' && !allowDraftOnPost) {
            throw new ForbiddenException('Posting payment with allocations to DRAFT customer invoices requires admin override');
          }
        }
        if (a.supplierInvoiceId) {
          const inv = await this.prisma.supplierInvoice.findUnique({ where: { id: a.supplierInvoiceId } });
          if (!inv) throw new BadRequestException('Invalid supplierInvoiceId in allocations');

          if (inv.status !== 'POSTED' && !allowDraftOnPost) {
            throw new ForbiddenException('Posting payment with allocations to DRAFT supplier invoices requires admin override');
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
    if (Math.abs(debit - credit) > 0.005) throw new BadRequestException('Payment journal not balanced');

    const updated = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.payment.findUnique({ where: { id } });
      if (!locked) throw new NotFoundException('Payment not found');
      if (locked.status !== PaymentStatus.DRAFT) throw new BadRequestException('Already posted/canceled');

      const payPosted = await tx.payment.update({
        where: { id },
        data: { status: PaymentStatus.POSTED, postedAt: new Date(), postedById: actor.sub },
      });

      // Create JE POSTED (same numbering approach as earlier; we’ll centralize later)
      const jeDate = new Date();
      const count = await tx.journalEntry.count({
        where: { documentDate: { gte: startOfDay(jeDate), lte: endOfDay(jeDate) } },
      });
      const jeNo = `JE-${jeDate.getFullYear()}${String(jeDate.getMonth() + 1).padStart(2, '0')}${String(
        jeDate.getDate(),
      ).padStart(2, '0')}-${String(count + 1).padStart(4, '0')}`;

      const je = await tx.journalEntry.create({
        data: {
          status: 'POSTED',
          documentNo: jeNo,
          documentDate: jeDate,
          description: `Payment ${pay.documentNo} posting`,
          sourceType: 'Payment',
          sourceId: pay.id,
          createdById: actor.sub,
          postedById: actor.sub,
          postedAt: new Date(),
          lines: { create: journalLines },
        },
      });

      return { payPosted, je };
    });

    await this.audit.log({
      actorId: actor.sub,
      action: AuditAction.POST,
      entity: 'Payment',
      entityId: id,
      after: { status: updated.payPosted.status, journalEntryId: updated.je.id },
      message: `Posted payment ${pay.documentNo} and created JE ${updated.je.documentNo}`,
    });

    return { ok: true, journalEntryId: updated.je.id };
  }
}
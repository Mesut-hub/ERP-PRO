import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  CustomerInvoiceStatus,
  PartyType,
  SalesOrderStatus,
  StockMoveType,
  VatRateCode,
} from '@prisma/client';
import { JwtAccessPayload } from '../../common/types/auth.types';
import { AuditService } from '../audit/audit.service';
import { AccountingService } from '../accounting/accounting.service';
import { DocNoService } from '../common/sequence/docno.service';
import { PostingLockService } from '../finance/posting-lock.service';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
    private readonly postingLock: PostingLockService,
    private readonly docNo: DocNoService,
    private readonly accounting: AccountingService,
  ) {}

  async listOrders() {
    return this.prisma.salesOrder.findMany({
      orderBy: { createdAt: 'desc' },
      include: { customer: true, warehouse: true, currency: true, lines: true },
      take: 100,
    });
  }

  async createOrder(actorId: string, dto: any) {
    if (!dto.lines || dto.lines.length === 0) throw new BadRequestException('Sales order must have lines');

    const customer = await this.prisma.party.findUnique({ where: { id: dto.customerId } });
    if (!customer || customer.type !== PartyType.CUSTOMER) throw new BadRequestException('customerId must be CUSTOMER');

    const wh = await this.prisma.warehouse.findUnique({ where: { id: dto.warehouseId } });
    if (!wh || !wh.isActive) throw new BadRequestException('Invalid warehouseId');

    const cur = await this.prisma.currency.findUnique({ where: { code: dto.currencyCode.toUpperCase() } });
    if (!cur || !cur.isActive) throw new BadRequestException('Invalid currencyCode');

    for (const l of dto.lines) {
      if (Number(l.quantity) <= 0) throw new BadRequestException('Line quantity must be > 0');
      if (Number(l.unitPrice) < 0) throw new BadRequestException('Line unitPrice must be >= 0');

      const p = await this.prisma.product.findUnique({ where: { id: l.productId } });
      if (!p || !p.isActive) throw new BadRequestException('Invalid productId');
      const u = await this.prisma.unit.findUnique({ where: { id: l.unitId } });
      if (!u) throw new BadRequestException('Invalid unitId');
      const v = await this.prisma.vatRate.findUnique({ where: { code: l.vatCode as VatRateCode } });
      if (!v) throw new BadRequestException('Invalid vatCode');
    }

    const docDate = dto.documentDate ? new Date(dto.documentDate) : new Date();
    const docNo = await this.docNo.allocate('SO', docDate);

    const created = await this.prisma.salesOrder.create({
      data: {
        status: SalesOrderStatus.DRAFT,
        documentNo: docNo,
        documentDate: docDate,
        customerId: dto.customerId,
        warehouseId: dto.warehouseId,
        currencyCode: cur.code,
        exchangeRateToBase: dto.exchangeRateToBase ?? null,
        notes: dto.notes,
        createdById: actorId,
        lines: {
          create: dto.lines.map((l: any) => ({
            productId: l.productId,
            unitId: l.unitId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            vatCode: l.vatCode,
            notes: l.notes,
          })),
        },
      },
      include: { lines: true },
    });

    await this.audit.log({
      actorId,
      action: AuditAction.CREATE,
      entity: 'SalesOrder',
      entityId: created.id,
      after: { documentNo: created.documentNo, status: created.status },
      message: `Created SO ${created.documentNo}`,
    });

    return created;
  }

  async approveOrder(actor: { sub: string; permissions: string[] }, id: string, reason?: string) {
    const so = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: { lines: true, customer: true },
    });
    if (!so) throw new NotFoundException('SalesOrder not found');
    if (so.status !== SalesOrderStatus.DRAFT) throw new BadRequestException('Only DRAFT orders can be approved');

    // Compute order gross total (subtotal + vat)
    let subtotal = 0;
    let vatTotal = 0;

    for (const l of so.lines) {
      const qty = Number(l.quantity);
      const unitPrice = Number(l.unitPrice);
      const lineSubtotal = qty * unitPrice;
      subtotal += lineSubtotal;

      const vatPct = await this.vatPercent(l.vatCode as VatRateCode);
      vatTotal += (lineSubtotal * vatPct) / 100;
    }

    const orderGross = subtotal + vatTotal;
    const creditCheckedAt = new Date();

    // Credit limit check (only if creditLimit is set)
    const creditLimit = so.customer.creditLimit ? Number(so.customer.creditLimit) : null;

    let exposure = 0;

    if (creditLimit !== null) {
      const arAccount = await this.prisma.account.findUnique({ where: { code: '120' } });
      if (!arAccount) throw new BadRequestException('Missing AR account 120');

      const agg = await this.prisma.journalLine.aggregate({
        where: {
          partyId: so.customerId,
          accountId: arAccount.id,
          entry: { status: 'POSTED' },
        },
        _sum: { debit: true, credit: true },
      });

      exposure = Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);

      if (exposure + orderGross > creditLimit + 1e-6) {
        const canOverride = (actor.permissions ?? []).includes('sales.credit.override');

        if (!canOverride) {
          throw new ForbiddenException(
            `Credit limit exceeded. Exposure=${exposure.toFixed(2)} + Order=${orderGross.toFixed(2)} > Limit=${creditLimit.toFixed(2)}`,
          );
        }

        const cleanReason = (reason ?? '').trim();
        if (!cleanReason) throw new BadRequestException('Credit override reason is required');

        const updated = await this.prisma.salesOrder.update({
          where: { id },
          data: {
            status: SalesOrderStatus.APPROVED,
            approvedById: actor.sub,
            approvedAt: new Date(),
            creditOverrideReason: cleanReason,
            creditCheckedAt,
            creditExposureAtApproval: exposure.toFixed(2),
          },
        });

        await this.audit.log({
          actorId: actor.sub,
          action: AuditAction.APPROVE,
          entity: 'SalesOrder',
          entityId: so.id,
          after: { creditOverride: true, reason: cleanReason, exposure, orderGross, creditLimit },
          message: `Approved SO ${so.documentNo} using credit override. Reason: ${cleanReason}`,
        });

        return { ok: true, override: true, salesOrderId: updated.id };
      }
    }

    const updated = await this.prisma.salesOrder.update({
      where: { id },
      data: {
        status: SalesOrderStatus.APPROVED,
        approvedById: actor.sub,
        approvedAt: new Date(),
        creditCheckedAt,
        creditExposureAtApproval: exposure.toFixed(2),
      },
    });

    await this.audit.log({
      actorId: actor.sub,
      action: AuditAction.APPROVE,
      entity: 'SalesOrder',
      entityId: id,
      after: { status: updated.status, exposure, orderGross, creditLimit },
      message: `Approved SO ${so.documentNo}`,
    });

    return { ok: true };
  }

  async deliverOrder(actor: JwtAccessPayload, soId: string, dto: any) {
    const so = await this.prisma.salesOrder.findUnique({
      where: { id: soId },
      include: { lines: true },
    });
    if (!so) throw new NotFoundException('SalesOrder not found');
    if (so.status === SalesOrderStatus.CANCELED) throw new BadRequestException('SalesOrder canceled');
    if (so.status === SalesOrderStatus.DRAFT) throw new ForbiddenException('SalesOrder must be approved before delivery');

    if (!dto.lines || dto.lines.length === 0) throw new BadRequestException('Delivery must have lines');

    const soLineById = new Map(so.lines.map((l) => [l.id, l]));

    const deliveredAgg = await this.prisma.salesDeliveryLine.groupBy({
      by: ['productId'],
      where: { delivery: { soId } },
      _sum: { quantity: true },
    });

    const deliveredByProduct = new Map<string, number>();
    for (const d of deliveredAgg) deliveredByProduct.set(d.productId, Number(d._sum.quantity ?? 0));

    for (const dl of dto.lines) {
      const soLine = soLineById.get(dl.soLineId);
      if (!soLine) throw new BadRequestException('Invalid soLineId');

      const already = deliveredByProduct.get(soLine.productId) ?? 0;
      const newQty = Number(dl.quantity);

      if (newQty <= 0) throw new BadRequestException('Delivery quantity must be > 0');
      if (already + newQty > Number(soLine.quantity) + 1e-9) {
        throw new BadRequestException('Delivering exceeds ordered quantity');
      }
    }

    const now = new Date();
    const delNo = await this.docNo.allocate('DEL', now);

    const delivery = await this.prisma.salesDelivery.create({
      data: {
        documentNo: delNo,
        documentDate: now,
        soId,
        warehouseId: so.warehouseId,
        notes: dto.notes,
        createdById: actor.sub,
        lines: {
          create: dto.lines.map((dl: any) => {
            const soLine = soLineById.get(dl.soLineId)!;
            return {
              productId: soLine.productId,
              unitId: soLine.unitId,
              quantity: dl.quantity,
              notes: dl.notes,
            };
          }),
        },
      },
      include: { lines: true },
    });

    // Create + POST inventory ISSUE
    const move = await this.inventory.createMove(actor.sub, {
      type: StockMoveType.ISSUE,
      fromWarehouseId: so.warehouseId,
      documentDate: now.toISOString(),
      notes: `Delivery for SO ${so.documentNo} (${delivery.documentNo})`,
      lines: delivery.lines.map((l) => ({
        productId: l.productId,
        unitId: l.unitId,
        quantity: l.quantity.toString(),
        notes: l.notes,
      })),
    });

    await this.inventory.postMove(actor, move.id);

    await this.prisma.salesDelivery.update({
      where: { id: delivery.id },
      data: { stockMoveId: move.id },
    });

    // Update SO status
    const orderedAgg = so.lines.reduce((sum, l) => sum + Number(l.quantity), 0);
    const totalDeliveredAgg = await this.prisma.salesDeliveryLine.aggregate({
      where: { delivery: { soId } },
      _sum: { quantity: true },
    });

    const totalDelivered = Number(totalDeliveredAgg._sum.quantity ?? 0);

    let newStatus: SalesOrderStatus = SalesOrderStatus.PARTIALLY_DELIVERED;
    if (Math.abs(totalDelivered - orderedAgg) < 1e-9) newStatus = SalesOrderStatus.DELIVERED;

    await this.prisma.salesOrder.update({
      where: { id: soId },
      data: { status: newStatus },
    });

    await this.audit.log({
      actorId: actor.sub,
      action: AuditAction.POST,
      entity: 'SalesDelivery',
      entityId: delivery.id,
      after: { documentNo: delivery.documentNo, stockMoveId: move.id },
      message: `Delivered SO ${so.documentNo} with ${delivery.documentNo}`,
    });

    return { deliveryId: delivery.id, stockMoveId: move.id };
  }

  private async vatPercent(vatCode: VatRateCode): Promise<number> {
    const v = await this.prisma.vatRate.findUnique({ where: { code: vatCode } });
    if (!v) throw new BadRequestException('Invalid vatCode');
    return Number(v.percent);
  }

  async listInvoices() {
    return this.prisma.customerInvoice.findMany({
      orderBy: { createdAt: 'desc' },
      include: { customer: true, currency: true, lines: true },
      take: 100,
    });
  }

  async createInvoice(actorId: string, dto: any) {
    if (!dto.lines || dto.lines.length === 0) throw new BadRequestException('Invoice must have lines');

    const customer = await this.prisma.party.findUnique({ where: { id: dto.customerId } });
    if (!customer || customer.type !== PartyType.CUSTOMER) throw new BadRequestException('customerId must be CUSTOMER');

    const cur = await this.prisma.currency.findUnique({ where: { code: dto.currencyCode.toUpperCase() } });
    if (!cur || !cur.isActive) throw new BadRequestException('Invalid currencyCode');

    if (dto.soId) {
      const so = await this.prisma.salesOrder.findUnique({ where: { id: dto.soId } });
      if (!so) throw new BadRequestException('Invalid soId');
    }

    for (const l of dto.lines) {
      if (Number(l.quantity) <= 0) throw new BadRequestException('Line quantity must be > 0');
      if (Number(l.unitPrice) < 0) throw new BadRequestException('Line unitPrice must be >= 0');
      if (l.productId) {
        const p = await this.prisma.product.findUnique({ where: { id: l.productId } });
        if (!p) throw new BadRequestException('Invalid productId');
      }
      await this.vatPercent(l.vatCode);
    }

    let subtotal = 0;
    let vatTotal = 0;
    const lineComputed: any[] = [];

    for (const l of dto.lines) {
      const qty = Number(l.quantity);
      const unitPrice = Number(l.unitPrice);
      const lineSubtotal = qty * unitPrice;

      const vatPct = await this.vatPercent(l.vatCode);
      const lineVat = (lineSubtotal * vatPct) / 100;
      const lineTotal = lineSubtotal + lineVat;

      subtotal += lineSubtotal;
      vatTotal += lineVat;

      lineComputed.push({
        productId: l.productId ?? null,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        vatCode: l.vatCode,
        lineSubtotal: lineSubtotal.toFixed(2),
        lineVat: lineVat.toFixed(2),
        lineTotal: lineTotal.toFixed(2),
      });
    }

    const grandTotal = subtotal + vatTotal;

    const docDate = dto.documentDate ? new Date(dto.documentDate) : new Date();
    const docNo = await this.docNo.allocate('CI', docDate);

    const created = await this.prisma.customerInvoice.create({
      data: {
        status: CustomerInvoiceStatus.DRAFT,
        documentNo: docNo,
        documentDate: docDate,
        customerId: dto.customerId,
        soId: dto.soId ?? null,
        currencyCode: cur.code,
        exchangeRateToBase: dto.exchangeRateToBase ?? null,
        subtotal: subtotal.toFixed(2),
        vatTotal: vatTotal.toFixed(2),
        grandTotal: grandTotal.toFixed(2),
        notes: dto.notes,
        createdById: actorId,
        lines: { create: lineComputed },
      },
      include: { lines: true },
    });

    await this.audit.log({
      actorId,
      action: AuditAction.CREATE,
      entity: 'CustomerInvoice',
      entityId: created.id,
      after: { documentNo: created.documentNo, grandTotal: created.grandTotal },
      message: `Created Customer Invoice ${created.documentNo}`,
    });

    return created;
  }

  async postInvoice(actor: JwtAccessPayload, id: string) {
    const inv = await this.prisma.customerInvoice.findUnique({
      where: { id },
      include: { customer: true },
    });
    if (!inv) throw new NotFoundException('CustomerInvoice not found');
    if (inv.status !== CustomerInvoiceStatus.DRAFT) throw new BadRequestException('Only DRAFT invoices can be posted');

    await this.postingLock.assertPostingAllowed(actor, inv.documentDate, `Sales.postInvoice invoiceId=${inv.id}`);

    const accAR = await this.prisma.account.findUnique({ where: { code: '120' } });
    const accSales = await this.prisma.account.findUnique({ where: { code: '600' } });
    const accVatPayable = await this.prisma.account.findUnique({ where: { code: '391' } });
    if (!accAR || !accSales || !accVatPayable) throw new BadRequestException('Missing required accounts (120, 600, 391)');

    const subtotal = Number(inv.subtotal);
    const vatTotal = Number(inv.vatTotal);
    const grandTotal = Number(inv.grandTotal);

    const journalLines: any[] = [
      {
        accountId: accAR.id,
        partyId: inv.customerId,
        description: `AR ${inv.customer.name} (${inv.documentNo})`,
        debit: grandTotal.toFixed(2),
        credit: '0',
        currencyCode: inv.currencyCode,
        amountCurrency: grandTotal.toFixed(2),
      },
      {
        accountId: accSales.id,
        partyId: inv.customerId,
        description: `Sales revenue (${inv.documentNo})`,
        debit: '0',
        credit: subtotal.toFixed(2),
        currencyCode: inv.currencyCode,
        amountCurrency: subtotal.toFixed(2),
      },
    ];

    if (vatTotal > 0) {
      journalLines.push({
        accountId: accVatPayable.id,
        partyId: inv.customerId,
        description: `KDV output (${inv.documentNo})`,
        debit: '0',
        credit: vatTotal.toFixed(2),
        currencyCode: inv.currencyCode,
        amountCurrency: vatTotal.toFixed(2),
      });
    }

    const debit = journalLines.reduce((s, l) => s + Number(l.debit), 0);
    const credit = journalLines.reduce((s, l) => s + Number(l.credit), 0);
    if (Math.abs(debit - credit) > 0.005) throw new BadRequestException('Auto journal not balanced');

    // Post invoice (transaction) then create JE via AccountingService
    const invPosted = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.customerInvoice.findUnique({ where: { id } });
      if (!locked) throw new NotFoundException('CustomerInvoice not found');
      if (locked.status !== CustomerInvoiceStatus.DRAFT) throw new BadRequestException('Already posted/canceled');

      return tx.customerInvoice.update({
        where: { id },
        data: { status: CustomerInvoiceStatus.POSTED, postedAt: new Date(), postedById: actor.sub },
      });
    });

    const je = await this.accounting.createPostedFromIntegration(actor.sub, {
      documentDate: inv.documentDate,
      description: `Customer invoice ${inv.documentNo} posting`,
      sourceType: 'CustomerInvoice',
      sourceId: inv.id,
      lines: journalLines,
    });

    await this.audit.log({
      actorId: actor.sub,
      action: AuditAction.POST,
      entity: 'CustomerInvoice',
      entityId: id,
      after: { status: invPosted.status, journalEntryId: je.id },
      message: `Posted Customer Invoice ${inv.documentNo} and created JE ${je.documentNo}`,
    });

    return { ok: true, journalEntryId: je.id };
  }
}
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  CustomerInvoiceStatus,
  PartyType,
  SalesOrderStatus,
  StockMoveType,
  VatRateCode,
  InvoiceKind,
} from '@prisma/client';
import { JwtAccessPayload } from '../../common/types/auth.types';
import { AuditService } from '../audit/audit.service';
import { AccountingService } from '../accounting/accounting.service';
import { DocNoService } from '../common/sequence/docno.service';
import { PostingLockService } from '../finance/posting-lock.service';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceNoteDto } from './dto/create-invoice-note.dto';
import { CreateSalesReturnDto } from './dto/create-sales-return.dto';

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Professional MVP: deterministic VAT mapping.
 * Later, replace with a VatCode table lookup (and keep same interface).
 */
function vatRateFromCode(vatCode: string): number {
  const code = (vatCode ?? '').toUpperCase().trim();
  switch (code) {
    case 'KDV_0': return 0;
    case 'KDV_1': return 1;
    case 'KDV_8': return 8;
    case 'KDV_10': return 10;
    case 'KDV_18': return 18;
    case 'KDV_20': return 20;
    default:
      throw new BadRequestException(`Unsupported vatCode: ${vatCode}`);
  }
}

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

    // after delivery is created and move is posted and stockMoveId is set

    // --- Persist delivery cost snapshot (unitCost/lineCost) ---
    const costUpdates: Array<{ id: string; unitCost: string; lineCost: string }> = [];

    for (const l of delivery.lines) {
      const qty = Number(l.quantity);

      const costRow = await this.prisma.inventoryCost.findUnique({
        where: { productId_warehouseId: { productId: l.productId, warehouseId: so.warehouseId } },
      });
      const avg = costRow ? Number(costRow.avgUnitCost) : 0;

      if (!Number.isFinite(avg) || avg <= 0) {
        throw new BadRequestException(
          `Missing inventory cost for product ${l.productId} in warehouse ${so.warehouseId}. Receive goods first to establish cost.`,
        );
      }

      const lineCost = Math.round((qty * avg + Number.EPSILON) * 100) / 100;

      costUpdates.push({
        id: l.id,
        unitCost: avg.toFixed(6),
        lineCost: lineCost.toFixed(2),
      });
    }

    // write snapshot
    await this.prisma.$transaction(
      costUpdates.map((u) =>
        this.prisma.salesDeliveryLine.update({
          where: { id: u.id },
          data: { unitCost: u.unitCost as any, lineCost: u.lineCost as any },
        }),
      ),
    );

    const verify = await this.prisma.salesDeliveryLine.findMany({
      where: { deliveryId: delivery.id },
      select: { id: true, unitCost: true, lineCost: true },
    });
    if (verify.some(v => v.unitCost === null || v.lineCost === null)) {
      throw new BadRequestException('Failed to persist delivery cost snapshot');
    }

    // compute totalCost from snapshot (authoritative)
    let totalCost = costUpdates.reduce((s, u) => s + Number(u.lineCost), 0);
    totalCost = Math.round((totalCost + Number.EPSILON) * 100) / 100;

    // =========================
    // STEP 19.3: COGS RECOGNITION
    // =========================
    const accCogs = await this.prisma.account.findUnique({ where: { code: '621' } });
    const accInv = await this.prisma.account.findUnique({ where: { code: '150' } });
    if (!accCogs || !accInv) throw new BadRequestException('Missing required accounts (621, 150)');

    if (totalCost > 0) {
      const journalLines: any[] = [
        {
          accountId: accCogs.id,
          partyId: so.customerId,
          description: `COGS for delivery ${delivery.documentNo} (SO ${so.documentNo})`,
          debit: totalCost.toFixed(2),
          credit: '0',
          currencyCode: so.currencyCode,
          amountCurrency: totalCost.toFixed(2),
        },
        {
          accountId: accInv.id,
          partyId: so.customerId,
          description: `Inventory out for delivery ${delivery.documentNo} (SO ${so.documentNo})`,
          debit: '0',
          credit: totalCost.toFixed(2),
          currencyCode: so.currencyCode,
          amountCurrency: totalCost.toFixed(2),
        },
      ];

      const je = await this.accounting.createPostedFromIntegration(actor.sub, {
        documentDate: delivery.documentDate,
        description: `COGS posting for delivery ${delivery.documentNo}`,
        sourceType: 'SalesDelivery',
        sourceId: delivery.id,
        lines: journalLines,
      });

      await this.audit.log({
        actorId: actor.sub,
        action: AuditAction.POST,
        entity: 'SalesDelivery',
        entityId: delivery.id,
        after: { cogs: totalCost.toFixed(2), journalEntryId: je.id },
        message: `Posted COGS for ${delivery.documentNo} with JE ${je.documentNo}`,
      });
    }

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

  async backfillDeliveryCostSnapshot(actor: JwtAccessPayload, deliveryId: string) {
    const delivery = await this.prisma.salesDelivery.findUnique({
      where: { id: deliveryId },
      include: { lines: true, so: true },
    });
    if (!delivery) throw new NotFoundException('SalesDelivery not found');

    // Do not overwrite existing snapshot (professional safeguard)
    if (delivery.lines.every((l) => l.unitCost !== null && l.lineCost !== null)) {
      return { ok: true, skipped: true, reason: 'Delivery already has cost snapshot' };
    }

    // Find posted JE for this delivery
    const je = await this.prisma.journalEntry.findFirst({
      where: {
        status: 'POSTED',
        sourceType: 'SalesDelivery',
        sourceId: delivery.id,
      },
      include: { lines: { include: { account: true } } },
      orderBy: { createdAt: 'desc' },
    });

    if (!je) {
      throw new BadRequestException('Cannot backfill: no POSTED COGS journal entry found for this delivery');
    }

    // Total COGS = debit on 621
    const cogsLines = je.lines.filter((l) => l.account.code === '621');
    const totalCogs = cogsLines.reduce((s, l) => s + Number(l.debit), 0);

    if (totalCogs <= 0) {
      throw new BadRequestException('Cannot backfill: COGS amount is zero; delivery likely has no cost posting');
    }

    // Allocate by quantity (MVP). If multiple products, this is still consistent but not perfect.
    // For perfect allocation across products, you’d need product-level cost captured per line originally.
    const totalQty = delivery.lines.reduce((s, l) => s + Number(l.quantity), 0);
    if (totalQty <= 0) throw new BadRequestException('Invalid delivery lines: total quantity is zero');

    const updates = delivery.lines.map((l) => {
      // Only fill missing ones
      if (l.unitCost !== null && l.lineCost !== null) return null;

      const qty = Number(l.quantity);
      const ratio = qty / totalQty;

      const lineCost = Math.round((totalCogs * ratio + Number.EPSILON) * 100) / 100;
      const unitCost = qty <= 0 ? 0 : lineCost / qty; // derived

      return this.prisma.salesDeliveryLine.update({
        where: { id: l.id },
        data: {
          unitCost: unitCost.toFixed(6) as any,
          lineCost: lineCost.toFixed(2) as any,
        },
      });
    }).filter(Boolean) as any[];

    await this.prisma.$transaction(updates);

    await this.audit.log({
      actorId: actor.sub,
      action: AuditAction.UPDATE,
      entity: 'SalesDelivery',
      entityId: delivery.id,
      after: { backfilled: true, journalEntryId: je.id, totalCogs: totalCogs.toFixed(2) },
      message: `Backfilled delivery cost snapshot for ${delivery.documentNo} using JE ${je.documentNo}. Allocation=by_quantity.`,
    });

    return { ok: true, backfilled: true, deliveryId: delivery.id, journalEntryId: je.id, totalCogs: totalCogs.toFixed(2) };
  }
    
  async createSalesReturn(actor: JwtAccessPayload, deliveryId: string, dto: CreateSalesReturnDto) {
    const delivery = await this.prisma.salesDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        so: true,
        lines: true,
      },
    });
    if (!delivery) throw new NotFoundException('SalesDelivery not found');

    if (!dto.lines?.length) throw new BadRequestException('Return must have lines');

    // Must have cost snapshot present (professional enforcement)
    const deliveryLineById = new Map(delivery.lines.map((l) => [l.id, l]));

    // Prevent returning more than delivered (per product, using SalesReturnLine + SalesDeliveryLine sums)
    const returnedAgg = await this.prisma.salesReturnLine.groupBy({
      by: ['productId'],
      where: { salesReturn: { deliveryId } },
      _sum: { quantity: true },
    });
    const returnedByProduct = new Map<string, number>();
    for (const r of returnedAgg) returnedByProduct.set(r.productId, Number(r._sum.quantity ?? 0));

    for (const rl of dto.lines) {
      const dl = deliveryLineById.get(rl.deliveryLineId);
      if (!dl) throw new BadRequestException('Invalid deliveryLineId');

      const newQty = Number(rl.quantity);
      if (newQty <= 0) throw new BadRequestException('Return quantity must be > 0');

      const already = returnedByProduct.get(dl.productId) ?? 0;
      const deliveredQty = Number(dl.quantity);

      if (already + newQty > deliveredQty + 1e-9) {
        throw new BadRequestException('Returning exceeds delivered quantity');
      }

      if (dl.unitCost === null || dl.lineCost === null) {
        throw new BadRequestException(`Delivery line ${dl.id} is missing cost snapshot; cannot return`);
      }
    }

    const docDate = dto.documentDate ? new Date(dto.documentDate) : new Date();
    await this.postingLock.assertPostingAllowed(
      actor,
      docDate,
      `Sales.createSalesReturn deliveryId=${delivery.id}`,
      undefined,
    );

    const docNo = await this.docNo.allocate('SRN', docDate);

    // Create SalesReturn + lines (copy unitCost/lineCost from delivery snapshot proportionally)
    const createdReturn = await this.prisma.salesReturn.create({
      data: {
        documentNo: docNo,
        documentDate: docDate,
        deliveryId: delivery.id,
        warehouseId: delivery.warehouseId,
        reason: dto.reason,
        notes: dto.notes,
        createdById: actor.sub,
        lines: {
          create: dto.lines.map((rl) => {
            const dl = deliveryLineById.get(rl.deliveryLineId)!;
            const qty = Number(rl.quantity);
            
            const deliveredQty = Number(dl.quantity);
            const deliveredLineCost = Number(dl.lineCost);
            
            // proportional cost for partial return
            const ratio = qty / deliveredQty;
            const lineCost = Math.round((deliveredLineCost * ratio + Number.EPSILON) * 100) / 100;

            return {
              productId: dl.productId,
              unitId: dl.unitId,
              quantity: rl.quantity,
              unitCost: dl.unitCost!, // keep original unitCost snapshot
              lineCost: lineCost.toFixed(2),
              notes: rl.notes,
            };
          }),
        },
      },
      include: { lines: true, delivery: { include: { so: true } } },
    });

    // Create and post inventory RECEIPT back into warehouse
    const move = await this.inventory.createMove(actor.sub, {
      type: StockMoveType.RECEIPT,
      toWarehouseId: createdReturn.warehouseId,
      documentDate: docDate.toISOString(),
      notes: `Sales return ${createdReturn.documentNo} for delivery ${delivery.documentNo}`,
      lines: createdReturn.lines.map((l) => ({
        productId: l.productId,
        unitId: l.unitId,
        quantity: l.quantity.toString(),
        notes: l.notes,
      })),
    });

    await this.inventory.postMove(actor, move.id);

    await this.prisma.salesReturn.update({
      where: { id: createdReturn.id },
      data: { stockMoveId: move.id },
    });

    // Reverse COGS using snapshot costs
    const totalCost = createdReturn.lines.reduce((s, l) => s + Number(l.lineCost), 0);

    const accInv = await this.prisma.account.findUnique({ where: { code: '150' } });
    const accCogs = await this.prisma.account.findUnique({ where: { code: '621' } });
    if (!accInv || !accCogs) throw new BadRequestException('Missing required accounts (150, 621)');

    const journalLines: any[] = [
      {
        accountId: accInv.id,
        partyId: createdReturn.delivery.so.customerId,
        description: `Inventory back from sales return ${createdReturn.documentNo}`,
        debit: totalCost.toFixed(2),
        credit: '0',
        currencyCode: createdReturn.delivery.so.currencyCode,
        amountCurrency: totalCost.toFixed(2),
      },
      {
        accountId: accCogs.id,
        partyId: createdReturn.delivery.so.customerId,
        description: `Reverse COGS for sales return ${createdReturn.documentNo}`,
        debit: '0',
        credit: totalCost.toFixed(2),
        currencyCode: createdReturn.delivery.so.currencyCode,
        amountCurrency: totalCost.toFixed(2),
      },
    ];

    const je = await this.accounting.createPostedFromIntegration(actor.sub, {
      documentDate: createdReturn.documentDate,
      description: `Sales return ${createdReturn.documentNo} (delivery ${delivery.documentNo})`,
      sourceType: 'SalesReturn',
      sourceId: createdReturn.id,
      lines: journalLines,
    });

    await this.audit.log({
      actorId: actor.sub,
      action: AuditAction.POST,
      entity: 'SalesReturn',
      entityId: createdReturn.id,
      after: { stockMoveId: move.id, journalEntryId: je.id },
      message: `Posted sales return ${createdReturn.documentNo} with JE ${je.documentNo}. Reason: ${dto.reason}`,
    });

    return { ok: true, salesReturnId: createdReturn.id, stockMoveId: move.id, journalEntryId: je.id };
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

  async createInvoiceNote(actor: JwtAccessPayload, dto: CreateInvoiceNoteDto) {
    if (dto.kind !== InvoiceKind.CREDIT_NOTE && dto.kind !== InvoiceKind.DEBIT_NOTE) {
      throw new BadRequestException('kind must be CREDIT_NOTE or DEBIT_NOTE');
    }
    if (!dto.lines?.length) throw new BadRequestException('lines are required');

    const base = await this.prisma.customerInvoice.findUnique({
      where: { id: dto.noteOfId },
      include: { customer: true },
    });
    if (!base) throw new NotFoundException('Base invoice not found');

    if (base.status !== CustomerInvoiceStatus.POSTED) {
      throw new BadRequestException('Notes can only be issued against POSTED invoices');
    }

    const docDate = dto.documentDate ? new Date(dto.documentDate) : new Date();
    const seqCode = dto.kind === InvoiceKind.CREDIT_NOTE ? 'CCN' : 'CDN';
    const docNo = await this.docNo.allocate(seqCode, docDate);

    // Force same customer + currency as base invoice (professional control)
    const customerId = base.customerId;
    const currencyCode = base.currencyCode;
    
    // OPTIONAL but very professional: ensure VatRate exists and active in DB
    const vatCodes = Array.from(new Set(dto.lines.map((l) => l.vatCode)));
    const vatRates = await this.prisma.vatRate.findMany({
      where: { code: { in: vatCodes as any }, isActive: true },
      select: { code: true, percent: true },
    });
    if (vatRates.length !== vatCodes.length) throw new BadRequestException('One or more VAT codes are invalid/inactive');
    const vatPercentByCode = new Map(vatRates.map((v) => [v.code, Number(v.percent)]));

    // Compute line amounts and totals
    const computedLines = dto.lines.map((l) => {
      const qty = Number(l.quantity);
      const price = Number(l.unitPrice);
      if (!Number.isFinite(qty) || qty <= 0) throw new BadRequestException('Invalid quantity');
      if (!Number.isFinite(price) || price < 0) throw new BadRequestException('Invalid unitPrice');

      // Prefer DB percent; fallback to mapping for safety (or remove fallback if you want strict DB-only)
      const percent = vatPercentByCode.get(l.vatCode as any) ?? vatRateFromCode(l.vatCode);

      const lineSubtotal = round2(qty * price);
      const lineVat = round2(lineSubtotal * (percent / 100));
      const lineTotal = round2(lineSubtotal + lineVat);

      return {
        productId: l.productId ?? null,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        vatCode: l.vatCode as any,
        
        lineSubtotal: lineSubtotal.toFixed(2),
        lineVat: lineVat.toFixed(2),
        lineTotal: lineTotal.toFixed(2),
      };
    });

    const subtotal = round2(computedLines.reduce((s, x) => s + Number(x.lineSubtotal), 0));
    const vatTotal = round2(computedLines.reduce((s, x) => s + Number(x.lineVat), 0));
    const grandTotal = round2(computedLines.reduce((s, x) => s + Number(x.lineTotal), 0));

    // Force same customer + currency as base invoice (professional constraint)
    const created = await this.prisma.customerInvoice.create({
      data: {
        status: CustomerInvoiceStatus.DRAFT,
        kind: dto.kind,
        noteOfId: base.id,
        noteReason: dto.reason,

        documentNo: docNo,
        documentDate: docDate,
        customerId,
        currencyCode,

        subtotal: subtotal.toFixed(2),
        vatTotal: vatTotal.toFixed(2),
        grandTotal: grandTotal.toFixed(2),

        createdById: actor.sub,

        lines: {
          create: computedLines,
        },
      },
      include: { lines: true },
    });

    await this.audit.log({
      actorId: actor.sub,
      action: AuditAction.CREATE,
      entity: 'CustomerInvoice',
      entityId: created.id,
      after: { kind: created.kind, documentNo: created.documentNo, noteOfId: created.noteOfId },
      message: `Created ${created.kind} ${created.documentNo} for invoice ${base.documentNo}. Reason: ${dto.reason}`,
    });

    return created;
  }
  
  async postInvoice(actor: JwtAccessPayload, id: string, overrideReason?: string) {
    const inv = await this.prisma.customerInvoice.findUnique({
      where: { id },
      include: { customer: true },
    });
    if (!inv) throw new NotFoundException('CustomerInvoice not found');
    if (inv.status !== CustomerInvoiceStatus.DRAFT) throw new BadRequestException('Only DRAFT invoices can be posted');

    await this.postingLock.assertPostingAllowed(
      actor,
      inv.documentDate,
      `Sales.postInvoice invoiceId=${inv.id}`,
      overrideReason,
    );

    const accAR = await this.prisma.account.findUnique({ where: { code: '120' } });
    const accSales = await this.prisma.account.findUnique({ where: { code: '600' } });
    const accVatPayable = await this.prisma.account.findUnique({ where: { code: '391' } });
    if (!accAR || !accSales || !accVatPayable) throw new BadRequestException('Missing required accounts (120, 600, 391)');

    const subtotal = Number(inv.subtotal);
    const vatTotal = Number(inv.vatTotal);
    const grandTotal = Number(inv.grandTotal);

    const isCredit = inv.kind === InvoiceKind.CREDIT_NOTE;
    
    // Helper to flip debit/credit cleanly for CREDIT_NOTE
    const dr = (amt: number) => (isCredit ? '0' : amt.toFixed(2));
    const cr = (amt: number) => (isCredit ? amt.toFixed(2) : '0');
    const drRev = (amt: number) => (isCredit ? amt.toFixed(2) : '0');
    const crRev = (amt: number) => (isCredit ? '0' : amt.toFixed(2));

    const journalLines: any[] = [
      {
        accountId: accAR.id,
        partyId: inv.customerId,
        description: `${inv.kind} AR ${inv.customer.name} (${inv.documentNo})`,
        debit: dr(grandTotal),
        credit: cr(grandTotal),
        currencyCode: inv.currencyCode,
        amountCurrency: grandTotal.toFixed(2),
      },
      {
        accountId: accSales.id,
        partyId: inv.customerId,
        description: `${inv.kind} Sales revenue (${inv.documentNo})`,
        debit: drRev(subtotal),
        credit: crRev(subtotal),
        currencyCode: inv.currencyCode,
        amountCurrency: subtotal.toFixed(2),
      },
    ];

    if (vatTotal > 0) {
      journalLines.push({
        accountId: accVatPayable.id,
        partyId: inv.customerId,
        description: `${inv.kind} KDV output (${inv.documentNo})`,
        debit: drRev(vatTotal),
        credit: crRev(vatTotal),
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
      description: `${inv.kind} Customer invoice ${inv.documentNo} posting`,
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
      message: overrideReason
        ? `Posted Customer Invoice ${inv.kind} ${inv.documentNo} (override reason: ${overrideReason}) and created JE ${je.documentNo}`
        : `Posted Customer Invoice ${inv.kind} ${inv.documentNo} and created JE ${je.documentNo}`,
    });

    return { ok: true, journalEntryId: je.id };
  }

  async getDelivery(id: string) {
    const d = await this.prisma.salesDelivery.findUnique({
      where: { id },
      include: { so: true, lines: true, warehouse: true, stockMove: true },
    });
    if (!d) throw new NotFoundException('SalesDelivery not found');
    return d;
  }
}
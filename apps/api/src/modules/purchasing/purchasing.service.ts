import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, PartyType, PurchaseOrderStatus, StockMoveType, SupplierInvoiceStatus, VatRateCode } from '@prisma/client';
import { formatGrnNo, formatPoNo, formatSupplierInvNo } from './docno';
import { InventoryService } from '../inventory/inventory.service';
import { AccountingService } from '../accounting/accounting.service';
import { PostingLockService } from '../finance/posting-lock.service';
import { JwtAccessPayload } from '../../common/types/auth.types';

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
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
    private readonly accounting: AccountingService,
    private readonly postingLock: PostingLockService,
  ) {}

  private async nextPoNo(date: Date) {
    const count = await this.prisma.purchaseOrder.count({
      where: { documentDate: { gte: startOfDay(date), lte: endOfDay(date) } },
    });
    return formatPoNo(date, count + 1);
  }

  private async nextGrnNo(date: Date) {
    const count = await this.prisma.purchaseReceipt.count({
      where: { documentDate: { gte: startOfDay(date), lte: endOfDay(date) } },
    });
    return formatGrnNo(date, count + 1);
  }

  private async nextSupplierInvNo(date: Date) {
    const count = await this.prisma.supplierInvoice.count({
      where: { documentDate: { gte: startOfDay(date), lte: endOfDay(date) } },
    });
    return formatSupplierInvNo(date, count + 1);
  }

  private async getAccountByCode(code: string) {
    const a = await this.prisma.account.findUnique({ where: { code } });
    if (!a) throw new BadRequestException(`Missing required account code ${code}`);
    return a;
  }

  async listPOs() {
    return this.prisma.purchaseOrder.findMany({
      orderBy: { createdAt: 'desc' },
      include: { supplier: true, warehouse: true, currency: true, lines: true },
      take: 100,
    });
  }

  async createPO(actorId: string, dto: any) {
    if (!dto.lines || dto.lines.length === 0) throw new BadRequestException('PO must have lines');

    const supplier = await this.prisma.party.findUnique({ where: { id: dto.supplierId } });
    if (!supplier || supplier.type !== PartyType.SUPPLIER) throw new BadRequestException('supplierId must be a SUPPLIER');

    const wh = await this.prisma.warehouse.findUnique({ where: { id: dto.warehouseId } });
    if (!wh || !wh.isActive) throw new BadRequestException('Invalid warehouseId');

    const cur = await this.prisma.currency.findUnique({ where: { code: dto.currencyCode.toUpperCase() } });
    if (!cur || !cur.isActive) throw new BadRequestException('Invalid currencyCode');

    const docDate = dto.documentDate ? new Date(dto.documentDate) : new Date();
    const docNo = await this.nextPoNo(docDate);

    // Validate lines
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

    const created = await this.prisma.purchaseOrder.create({
      data: {
        status: PurchaseOrderStatus.DRAFT,
        documentNo: docNo,
        documentDate: docDate,
        supplierId: dto.supplierId,
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
      entity: 'PurchaseOrder',
      entityId: created.id,
      after: { id: created.id, documentNo: created.documentNo, status: created.status },
      message: `Created PO ${created.documentNo}`,
    });

    return created;
  }

  async approvePO(actorId: string, id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw new NotFoundException('PO not found');
    if (po.status !== PurchaseOrderStatus.DRAFT) throw new BadRequestException('Only DRAFT POs can be approved');

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.APPROVED,
        approvedById: actorId,
        approvedAt: new Date(),
      },
    });

    await this.audit.log({
      actorId,
      action: AuditAction.APPROVE,
      entity: 'PurchaseOrder',
      entityId: id,
      after: { status: updated.status },
      message: `Approved PO ${po.documentNo}`,
    });

    return { ok: true };
  }

  async receivePO(actor: JwtAccessPayload, poId: string, dto: any) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { lines: true, warehouse: true },
    });
    if (!po) throw new NotFoundException('PO not found');
    if (po.status === PurchaseOrderStatus.CANCELED) throw new BadRequestException('PO canceled');

    // In a strict process, require APPROVED. If you want faster, allow DRAFT too.
    if (po.status === PurchaseOrderStatus.DRAFT) {
      throw new ForbiddenException('PO must be approved before receiving');
    }

    if (!dto.lines || dto.lines.length === 0) throw new BadRequestException('Receipt must have lines');

    // Validate each receipt line references a PO line and does not exceed ordered qty minus already received.
    // MVP approach: compute received per PO line from PurchaseReceiptLine totals.
    const receivedAgg = await this.prisma.purchaseReceiptLine.groupBy({
      by: ['productId'],
      where: { receipt: { poId } },
      _sum: { quantity: true },
    });

    const receivedByProduct = new Map<string, number>();
    for (const r of receivedAgg) receivedByProduct.set(r.productId, Number(r._sum.quantity ?? 0));

    // Map PO lines by id
    const poLineById = new Map(po.lines.map((l) => [l.id, l]));

    for (const rl of dto.lines) {
      const poLine = poLineById.get(rl.poLineId);
      if (!poLine) throw new BadRequestException('Invalid poLineId');

      const already = receivedByProduct.get(poLine.productId) ?? 0;
      const newQty = Number(rl.quantity);
      if (newQty <= 0) throw new BadRequestException('Receipt quantity must be > 0');
      if (already + newQty > Number(poLine.quantity) + 1e-9) {
        throw new BadRequestException(`Receiving exceeds ordered qty for product ${poLine.productId}`);
      }
    }

    const now = new Date();
    const grnNo = await this.nextGrnNo(now);

    // Create receipt + create inventory stock move and post it
    const receipt = await this.prisma.$transaction(async (tx) => {
      const createdReceipt = await tx.purchaseReceipt.create({
        data: {
          documentNo: grnNo,
          documentDate: now,
          poId,
          warehouseId: po.warehouseId,
          notes: dto.notes,
          createdById: actor.sub,
          lines: {
            create: dto.lines.map((rl: any) => {
              const poLine = poLineById.get(rl.poLineId)!;
              return {
                productId: poLine.productId,
                unitId: poLine.unitId,
                quantity: rl.quantity,
                notes: rl.notes,
              };
            }),
          },
        },
        include: { lines: true },
      });

      return createdReceipt;
    });

    // Create and POST StockMove RECEIPT into the PO warehouse
    const move = await this.inventory.createMove(actor.sub, {
      type: StockMoveType.RECEIPT,
      toWarehouseId: po.warehouseId,
      documentDate: now.toISOString(),
      notes: `Receipt for PO ${po.documentNo} (${receipt.documentNo})`,
      lines: receipt.lines.map((l) => ({
        productId: l.productId,
        unitId: l.unitId,
        quantity: l.quantity.toString(),
        notes: l.notes,
      })),
    });

    await this.inventory.postMove(actor, move.id);

    await this.prisma.purchaseReceipt.update({
      where: { id: receipt.id },
      data: { stockMoveId: move.id },
    });

    // Update PO status (simple heuristic based on total received vs total ordered)
    const orderedAgg = po.lines.reduce((sum, l) => sum + Number(l.quantity), 0);
    const totalReceivedAgg = await this.prisma.purchaseReceiptLine.aggregate({
      where: { receipt: { poId } },
      _sum: { quantity: true },
    });
    const totalReceived = Number(totalReceivedAgg._sum.quantity ?? 0);

    let newStatus: PurchaseOrderStatus = PurchaseOrderStatus.PARTIALLY_RECEIVED;
    if (Math.abs(totalReceived - orderedAgg) < 1e-9) newStatus = PurchaseOrderStatus.RECEIVED;

    await this.prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status: newStatus },
    });

    await this.audit.log({
      actorId: actor.sub,
      action: AuditAction.POST,
      entity: 'PurchaseReceipt',
      entityId: receipt.id,
      after: { documentNo: receipt.documentNo, stockMoveId: move.id },
      message: `Received PO ${po.documentNo} with GRN ${receipt.documentNo}`,
    });

    return { receiptId: receipt.id, stockMoveId: move.id };
  }

  // --- Supplier invoice ---
  async listSupplierInvoices() {
    return this.prisma.supplierInvoice.findMany({
      orderBy: { createdAt: 'desc' },
      include: { supplier: true, currency: true, lines: true },
      take: 100,
    });
  }

  private async vatPercent(vatCode: VatRateCode): Promise<number> {
    const v = await this.prisma.vatRate.findUnique({ where: { code: vatCode } });
    if (!v) throw new BadRequestException('Invalid vatCode');
    return Number(v.percent);
  }

  async createSupplierInvoice(actorId: string, dto: any) {
    if (!dto.lines || dto.lines.length === 0) throw new BadRequestException('Invoice must have lines');

    const supplier = await this.prisma.party.findUnique({ where: { id: dto.supplierId } });
    if (!supplier || supplier.type !== PartyType.SUPPLIER) throw new BadRequestException('supplierId must be SUPPLIER');

    const cur = await this.prisma.currency.findUnique({ where: { code: dto.currencyCode.toUpperCase() } });
    if (!cur || !cur.isActive) throw new BadRequestException('Invalid currencyCode');

    if (dto.poId) {
      const po = await this.prisma.purchaseOrder.findUnique({ where: { id: dto.poId } });
      if (!po) throw new BadRequestException('Invalid poId');
    }

    // Validate products if provided
    for (const l of dto.lines) {
      if (Number(l.quantity) <= 0) throw new BadRequestException('Line quantity must be > 0');
      if (Number(l.unitPrice) < 0) throw new BadRequestException('Line unitPrice must be >= 0');

      if (l.productId) {
        const p = await this.prisma.product.findUnique({ where: { id: l.productId } });
        if (!p) throw new BadRequestException('Invalid productId');
      }
      await this.vatPercent(l.vatCode);
    }

    // Calculate totals (money amounts as decimals -> store as strings)
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
    const docNo = await this.nextSupplierInvNo(docDate);

    const created = await this.prisma.supplierInvoice.create({
      data: {
        status: SupplierInvoiceStatus.DRAFT,
        documentNo: docNo,
        documentDate: docDate,
        supplierId: dto.supplierId,
        poId: dto.poId ?? null,
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
      entity: 'SupplierInvoice',
      entityId: created.id,
      after: { documentNo: created.documentNo, grandTotal: created.grandTotal },
      message: `Created Supplier Invoice ${created.documentNo}`,
    });

    return created;
  }

  async postSupplierInvoice(actor: JwtAccessPayload, id: string) {
    const inv = await this.prisma.supplierInvoice.findUnique({
      where: { id },
      include: { lines: true, supplier: true },
    });
    if (!inv) throw new NotFoundException('SupplierInvoice not found');
    if (inv.status !== SupplierInvoiceStatus.DRAFT) throw new BadRequestException('Only DRAFT invoices can be posted');

    await this.postingLock.assertPostingAllowed(actor, inv.documentDate, `Purchasing.postSupplierInvoice invoiceId=${inv.id}`);
    // Accounts
    const accInventory = await this.getAccountByCode('150');
    const accVatIn = await this.getAccountByCode('191');
    const accAP = await this.getAccountByCode('320');
    const accExpense = await this.getAccountByCode('770');

    // Build journal lines
    // Debit goods/services subtotal split (product vs non-product)
    let productSubtotal = 0;
    let nonProductSubtotal = 0;
    for (const l of inv.lines) {
      const sub = Number(l.lineSubtotal);
      if (l.productId) productSubtotal += sub;
      else nonProductSubtotal += sub;
    }

    const vatTotal = Number(inv.vatTotal);
    const grandTotal = Number(inv.grandTotal);

    const journalLines: any[] = [];

    if (productSubtotal > 0) {
      journalLines.push({
        accountId: accInventory.id,
        description: `Supplier invoice ${inv.documentNo} goods`,
        debit: productSubtotal.toFixed(2),
        credit: '0',
        currencyCode: inv.currencyCode,
        amountCurrency: productSubtotal.toFixed(2),
        partyId: inv.supplierId,
      });
    }

    if (nonProductSubtotal > 0) {
      journalLines.push({
        accountId: accExpense.id,
        description: `Supplier invoice ${inv.documentNo} services/expenses`,
        debit: nonProductSubtotal.toFixed(2),
        credit: '0',
        currencyCode: inv.currencyCode,
        amountCurrency: nonProductSubtotal.toFixed(2),
        partyId: inv.supplierId,
      });
    }

    if (vatTotal > 0) {
      journalLines.push({
        accountId: accVatIn.id,
        description: `KDV input ${inv.documentNo}`,
        debit: vatTotal.toFixed(2),
        credit: '0',
        currencyCode: inv.currencyCode,
        amountCurrency: vatTotal.toFixed(2),
        partyId: inv.supplierId,
      });
    }

    // Credit AP
    journalLines.push({
      accountId: accAP.id,
      description: `AP ${inv.supplier.name} (${inv.documentNo})`,
      debit: '0',
      credit: grandTotal.toFixed(2),
      currencyCode: inv.currencyCode,
      amountCurrency: grandTotal.toFixed(2),
      partyId: inv.supplierId,
    });

    // Validate balance quickly
    const debit = journalLines.reduce((s, l) => s + Number(l.debit), 0);
    const credit = journalLines.reduce((s, l) => s + Number(l.credit), 0);
    if (Math.abs(debit - credit) > 0.005) {
      throw new BadRequestException(`Auto journal not balanced. debit=${debit}, credit=${credit}`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.supplierInvoice.findUnique({ where: { id } });
      if (!locked) throw new NotFoundException('SupplierInvoice not found');
      if (locked.status !== SupplierInvoiceStatus.DRAFT) throw new BadRequestException('Invoice already posted/canceled');

      // Post invoice
      const invPosted = await tx.supplierInvoice.update({
        where: { id },
        data: { status: SupplierInvoiceStatus.POSTED, postedAt: new Date(), postedById: actor.sub },
      });

      // Create + post journal entry (immediately POSTED)
      const jeCountDate = new Date();
      const jeCount = await tx.journalEntry.count({
        where: { documentDate: { gte: startOfDay(jeCountDate), lte: endOfDay(jeCountDate) } },
      });
      const jeNo = `JE-${jeCountDate.getFullYear()}${String(jeCountDate.getMonth() + 1).padStart(2, '0')}${String(
        jeCountDate.getDate(),
      ).padStart(2, '0')}-${String(jeCount + 1).padStart(4, '0')}`;

      const je = await tx.journalEntry.create({
        data: {
          status: 'POSTED',
          documentNo: jeNo,
          documentDate: jeCountDate,
          description: `Supplier invoice ${inv.documentNo} posting`,
          sourceType: 'SupplierInvoice',
          sourceId: inv.id,
          createdById: actor.sub,
          postedById: actor.sub,
          postedAt: new Date(),
          lines: { create: journalLines },
        },
      });

      return { invPosted, je };
    });

    await this.audit.log({
      actorId: actor.sub,
      action: AuditAction.POST,
      entity: 'SupplierInvoice',
      entityId: id,
      after: { status: updated.invPosted.status },
      message: `Posted Supplier Invoice ${inv.documentNo} and created JE ${updated.je.documentNo}`,
    });

    return { ok: true, journalEntryId: updated.je.id };
  }
}
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  InvoiceKind,
  PartyType,
  PurchaseOrderStatus,
  StockMoveType,
  SupplierInvoiceStatus,
  VatRateCode,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DocNoService } from '../common/sequence/docno.service';
import { InventoryService } from '../inventory/inventory.service';
import { AccountingService } from '../accounting/accounting.service';
import { PostingLockService } from '../finance/posting-lock.service';
import { JwtAccessPayload } from '../../common/types/auth.types';
import { CreateSupplierInvoiceNoteDto } from './dto/create-supplier-invoice-note.dto';
import { vatRateFromCode } from '../common/vat/vat-rate';
import { computeLineTotals } from '../common/invoice/line-totals';
import { FxService } from '../finance/fx/fx.service';
import { FifoService } from '../inventory/costing/fifo.service';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto';

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly docNo: DocNoService,
    private readonly inventory: InventoryService,
    private readonly accounting: AccountingService,
    private readonly postingLock: PostingLockService,
    private readonly fx: FxService,
    private readonly fifo: FifoService,
  ) {}

  private async getAccountByCode(code: string) {
    const a = await this.prisma.account.findUnique({ where: { code } });
    if (!a) throw new BadRequestException(`Missing required account code ${code}`);
    return a;
  }

  private sumReceiptNet(lines: Array<{ lineSubtotal: any }>) {
    return lines.reduce((s, l) => s + Number(l.lineSubtotal ?? 0), 0);
  }

  private async ensureScnPurchaseReturnClearingJe(params: {
    actorId: string;
    scnId: string;
    scnDocumentNo: string;
    supplierId: string | null;
    documentDate: Date;
  }) {
    // 1) If a clearing JE already exists (any JE for this SCN with account 328), do nothing.
    const existing = await this.prisma.journalEntry.findMany({
      where: { sourceType: 'SupplierInvoice', sourceId: params.scnId },
      include: { lines: { include: { account: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const alreadyHas328 = existing.some((je) => (je.lines ?? []).some((ln: any) => ln.account?.code === '328'));
    if (alreadyHas328) return;

    // 2) Sum linked purchase returns in base TRY
    const linkedReturns = await this.prisma.purchaseReturn.findMany({
      where: { supplierCreditNoteId: params.scnId },
      include: { lines: true },
    });

    if (!linkedReturns.length) return;

    const totalReturnBase = linkedReturns.reduce((sum, pr) => {
      const prTotal = pr.lines.reduce((s, l) => s + Number((l as any).lineCostBase ?? 0), 0);
      return sum + prTotal;
    }, 0);

    const amt = Math.round((totalReturnBase + Number.EPSILON) * 100) / 100;
    if (amt <= 0) return;

    const acc327 = await this.getAccountByCode('327');
    const acc328 = await this.getAccountByCode('328');

    await this.accounting.createPostedFromIntegration(params.actorId, {
      documentDate: params.documentDate,
      description: `SCN ${params.scnDocumentNo} clears Purchase Returns (Dr327/Cr328)`,
      sourceType: 'SupplierInvoice',
      sourceId: params.scnId,
      lines: [
        {
          accountId: acc327.id,
          partyId: params.supplierId,
          description: `SCN ${params.scnDocumentNo} base clearing debit`,
          debit: amt.toFixed(2),
          credit: '0',
          currencyCode: 'TRY',
          amountCurrency: amt.toFixed(2),
        },
        {
          accountId: acc328.id,
          partyId: params.supplierId,
          description: `SCN ${params.scnDocumentNo} clears Purchase Returns Clearing`,
          debit: '0',
          credit: amt.toFixed(2),
          currencyCode: 'TRY',
          amountCurrency: amt.toFixed(2),
        },
      ],
    });
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
    const docNo = await this.docNo.allocate('PO', docDate);

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

    if (po.status === PurchaseOrderStatus.DRAFT) {
      throw new ForbiddenException('PO must be approved before receiving');
    }

    if (!dto.lines || dto.lines.length === 0) throw new BadRequestException('Receipt must have lines');

    // Validate each receipt line references a PO line and does not exceed ordered qty minus already received.
    // IMPORTANT: must aggregate by poLineId (professional), not by productId.
    const receivedAgg = await this.prisma.purchaseReceiptLine.groupBy({
      by: ['poLineId'],
      where: { receipt: { poId } },
      _sum: { quantity: true },
    });

    const receivedByPoLineId = new Map<string, number>();
    for (const r of receivedAgg) receivedByPoLineId.set(r.poLineId, Number(r._sum.quantity ?? 0));

    const poLineById = new Map(po.lines.map((l) => [l.id, l]));

    for (const rl of dto.lines) {
      const poLine = poLineById.get(rl.poLineId);
      if (!poLine) throw new BadRequestException('Invalid poLineId');

      const already = receivedByPoLineId.get(poLine.id) ?? 0;
      const newQty = Number(rl.quantity);
      if (newQty <= 0) throw new BadRequestException('Receipt quantity must be > 0');

      if (already + newQty > Number(poLine.quantity) + 1e-9) {
        throw new BadRequestException(`Receiving exceeds ordered qty for poLineId=${poLine.id}`);
      }
    }

    const now = new Date();
    const grnNo = await this.docNo.allocate('GRN', now);

    // Create receipt with valuation fields (poLineId, unitPrice, vatCode, lineSubtotal)
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

              const qty = Number(rl.quantity);
              const unitPrice = Number(poLine.unitPrice);
              const lineSubtotal = qty * unitPrice;

              return {
                poLineId: poLine.id,
                productId: poLine.productId,
                unitId: poLine.unitId,
                quantity: rl.quantity,
                unitPrice: poLine.unitPrice,
                vatCode: poLine.vatCode,
                lineSubtotal: lineSubtotal.toFixed(2),
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

    // --- FIFO valuation: create inbound layers (base TRY) ---
    const rateToTry = await this.getRateToTryAtPosting(po.currencyCode, po.exchangeRateToBase, receipt.documentDate);

    await this.prisma.$transaction(async (tx) => {
      for (const l of receipt.lines) {
        const qty = Number(l.quantity);
        if (!Number.isFinite(qty) || qty <= 0) continue;

        // Receipt valuation uses net lineSubtotal (excluding VAT) in PO currency
        const netPoCurrency = Number(l.lineSubtotal);
        if (!Number.isFinite(netPoCurrency) || netPoCurrency < 0) {
          throw new BadRequestException('Invalid receipt lineSubtotal');
        }

        const netTry = netPoCurrency * rateToTry;
        const unitCostTry = netTry / qty;

        if (!Number.isFinite(unitCostTry) || unitCostTry <= 0) {
          throw new BadRequestException('Cannot create FIFO layer with non-positive unit cost');
        }

        await this.fifo.createInboundLayer(tx as any, {
          productId: l.productId,
          warehouseId: po.warehouseId,
          sourceType: 'PurchaseReceipt',
          sourceId: receipt.id,
          sourceLineId: l.id,
          receivedAt: receipt.documentDate,
          qtyIn: qty,
          unitCostBase: unitCostTry,
        });

        // Optional but recommended: valuation entry
        await (tx as any).inventoryValuationEntry.create({
          data: {
            productId: l.productId,
            warehouseId: po.warehouseId,
            sourceType: 'PurchaseReceipt',
            sourceId: receipt.id,
            sourceLineId: l.id,
            method: 'FIFO',
            quantityIn: qty.toFixed(4),
            quantityOut: '0',
            amountBase: (Math.round((netTry + Number.EPSILON) * 100) / 100).toFixed(2),
          },
        });
      }
    });

    // --- Accounting: GRNI accrual at receipt time ---
    const net = this.sumReceiptNet(receipt.lines);
    if (net > 0) {
      const accInv = await this.getAccountByCode('150');
      const accGrni = await this.getAccountByCode('327');

      const je = await this.accounting.createPostedFromIntegration(actor.sub, {
        documentDate: receipt.documentDate,
        description: `GRNI accrual for receipt ${receipt.documentNo} (PO ${po.documentNo})`,
        sourceType: 'PurchaseReceipt',
        sourceId: receipt.id,
        lines: [
          {
            accountId: accInv.id,
            partyId: po.supplierId,
            description: `GRN ${receipt.documentNo} Inventory receipt`,
            debit: net.toFixed(2),
            credit: '0',
            currencyCode: po.currencyCode,
            amountCurrency: net.toFixed(2),
          },
          {
            accountId: accGrni.id,
            partyId: po.supplierId,
            description: `GRN ${receipt.documentNo} GRNI accrual`,
            debit: '0',
            credit: net.toFixed(2),
            currencyCode: po.currencyCode,
            amountCurrency: net.toFixed(2),
          },
        ],
      });

      await this.audit.log({
        actorId: actor.sub,
        action: AuditAction.POST,
        entity: 'PurchaseReceipt',
        entityId: receipt.id,
        after: { journalEntryId: je.id, net: net.toFixed(2) },
        message: `Posted GRNI for receipt ${receipt.documentNo} with JE ${je.documentNo}`,
      });
    }

    // --- Step 19 prerequisite: update weighted average cost (WAC) ---
    // NOTE: This requires Prisma schema to have InventoryCost + @@unique([productId, warehouseId])
    for (const l of receipt.lines) {
      const qty = Number(l.quantity);
      if (!Number.isFinite(qty) || qty <= 0) continue;

      const unitCost = Number(l.lineSubtotal) / qty;

      // onhand AFTER posting already includes this receipt qty
      const sums = await this.prisma.stockLedgerEntry.aggregate({
        where: { warehouseId: po.warehouseId, productId: l.productId },
        _sum: { quantityIn: true, quantityOut: true },
      });
      const onHandAfter = Number(sums._sum.quantityIn ?? 0) - Number(sums._sum.quantityOut ?? 0);
      const onHandBefore = onHandAfter - qty;

      const existing = await this.prisma.inventoryCost.findUnique({
        where: { productId_warehouseId: { productId: l.productId, warehouseId: po.warehouseId } },
      });
      const oldAvg = existing ? Number(existing.avgUnitCost) : 0;

      const denom = onHandBefore + qty;
      const newAvg =
        denom <= 0
          ? unitCost
          : ((onHandBefore * oldAvg) + (qty * unitCost)) / denom;

      await this.prisma.inventoryCost.upsert({
        where: { productId_warehouseId: { productId: l.productId, warehouseId: po.warehouseId } },
        update: { avgUnitCost: newAvg.toFixed(6) },
        create: { productId: l.productId, warehouseId: po.warehouseId, avgUnitCost: newAvg.toFixed(6) },
      });
    }

    // Update PO status (based on total received vs total ordered)
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

  async createPurchaseReturn(actor: JwtAccessPayload, receiptId: string, dto: CreatePurchaseReturnDto, overrideReason?: string) {
    if (!dto.lines || dto.lines.length === 0) throw new BadRequestException('Return must have lines');

    const docDate = new Date(dto.documentDate);
    if (Number.isNaN(docDate.getTime())) throw new BadRequestException('Invalid documentDate');

    await this.postingLock.assertPostingAllowed(
      actor,
      docDate,
      `Purchasing.createPurchaseReturn receiptId=${receiptId}`,
      overrideReason,
    );

    const receipt = await this.prisma.purchaseReceipt.findUnique({
      where: { id: receiptId },
      include: { po: true, warehouse: true, lines: true },
    });
    if (!receipt) throw new NotFoundException('PurchaseReceipt not found');

    let postedInv: { id: string; documentNo: string } | null = null;

    // Professional control (temporary): block if PO has POSTED invoice until SCN workflow is implemented
    if (receipt.poId) {
      postedInv = await this.prisma.supplierInvoice.findFirst({
        where: { poId: receipt.poId, status: SupplierInvoiceStatus.POSTED, kind: InvoiceKind.INVOICE },
        select: { id: true, documentNo: true },
        orderBy: { documentDate: 'desc' },
      });
    }

    let scn: { 
      id: string;
      documentNo: string;
      noteOfId: string,
      poId: string | null;
      kind: InvoiceKind;
      status: SupplierInvoiceStatus; 
    } | null = null;

    if (postedInv) {
      if (!dto.supplierCreditNoteId) {
        throw new BadRequestException(
          `Supplier invoice ${postedInv.documentNo} is POSTED. Provide supplierCreditNoteId (POSTED CREDIT_NOTE) to allow return-after-invoice.`,
        );
      }

      scn = await this.prisma.supplierInvoice.findUnique({
        where: { id: dto.supplierCreditNoteId },
        select: { 
          id: true,
          documentNo: true,
          noteOfId: true,
          status: true,
          kind: true,
          poId: true 
        },
      }) as any;

      if (!scn) throw new BadRequestException('Invalid supplierCreditNoteId');
      if (scn.poId !== receipt.poId) throw new BadRequestException('Credit note does not belong to same PO');
      if (scn.kind !== InvoiceKind.CREDIT_NOTE) throw new BadRequestException('supplierCreditNoteId must be CREDIT_NOTE');
      if (scn.status !== SupplierInvoiceStatus.POSTED) throw new BadRequestException('Credit note must be POSTED');
      if (scn.noteOfId !== postedInv.id) {
        throw new BadRequestException(`Credit note must be issued as a note of invoice ${postedInv.documentNo}`);
    }
  }

    // Validate receiptLineId and quantities
    const receiptLineById = new Map(receipt.lines.map((l) => [l.id, l]));

    const returnedAgg = await this.prisma.purchaseReturnLine.groupBy({
      by: ['receiptLineId'],
      where: { purchaseReturn: { receiptId } },
      _sum: { quantity: true },
    });
    const returnedByLine = new Map<string, number>();
    for (const r of returnedAgg) returnedByLine.set(r.receiptLineId, Number(r._sum.quantity ?? 0));

    for (const rl of dto.lines) {
      const base = receiptLineById.get(rl.receiptLineId);
      if (!base) throw new BadRequestException('Invalid receiptLineId');

      const qty = Number(rl.quantity);
      if (!Number.isFinite(qty) || qty <= 0) throw new BadRequestException('Return quantity must be > 0');

      const alreadyReturned = returnedByLine.get(base.id) ?? 0;
      if (alreadyReturned + qty > Number(base.quantity) + 1e-9) {
        throw new BadRequestException(`Return exceeds received qty for receiptLineId=${base.id}`);
      }
    }

    const prNo = await this.docNo.allocate('PRTN', docDate);

    // Create return + lines (cost snapshot filled after FIFO allocation)
    const createdReturn = await this.prisma.purchaseReturn.create({
      data: {
        documentNo: prNo,
        documentDate: docDate,
        receiptId: receipt.id,
        warehouseId: receipt.warehouseId,
        supplierCreditNoteId: dto.supplierCreditNoteId ?? null,
        reason: dto.reason,
        notes: dto.notes,
        createdById: actor.sub,
        lines: {
          create: dto.lines.map((rl) => {
            const base = receiptLineById.get(rl.receiptLineId)!;
            return {
              receiptLineId: base.id,
              productId: base.productId,
              unitId: base.unitId,
              quantity: rl.quantity,
              unitCostBase: '0.000000',
              lineCostBase: '0.00',
              notes: rl.notes,
            };
          }),
        },
      },
      include: { lines: true },
    });

    // Create & post StockMove ISSUE
    const move = await this.inventory.createMove(actor.sub, {
      type: StockMoveType.ISSUE,
      fromWarehouseId: receipt.warehouseId,
      documentDate: docDate.toISOString(),
      notes: `Purchase return ${createdReturn.documentNo} against GRN ${receipt.documentNo}`,
      lines: createdReturn.lines.map((l) => ({
        productId: l.productId,
        unitId: l.unitId,
        quantity: l.quantity.toString(),
        notes: l.notes,
      })),
    });

    await this.inventory.postMove(actor, move.id, undefined, overrideReason);

    await this.prisma.purchaseReturn.update({
      where: { id: createdReturn.id },
      data: { stockMoveId: move.id },
    });

    // FIFO allocate + update snapshots + valuation entries
    let totalCost = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const l of createdReturn.lines) {
        const qty = Number(l.quantity);

        const alloc = await this.fifo.allocateOutbound(tx as any, {
          productId: l.productId,
          warehouseId: receipt.warehouseId,
          issueSourceType: 'PurchaseReturn',
          issueSourceId: createdReturn.id,
          issueSourceLineId: l.id,
          qtyOut: qty,
        });

        const lineCost = alloc.totalAmountBase;
        const unitCost = lineCost / qty;

        totalCost += lineCost;

        await (tx as any).purchaseReturnLine.update({
          where: { id: l.id },
          data: { unitCostBase: unitCost.toFixed(6), lineCostBase: lineCost.toFixed(2) },
        });

        await (tx as any).inventoryValuationEntry.create({
          data: {
            productId: l.productId,
            warehouseId: receipt.warehouseId,
            sourceType: 'PurchaseReturn',
            sourceId: createdReturn.id,
            sourceLineId: l.id,
            method: 'FIFO',
            quantityIn: '0',
            quantityOut: qty.toFixed(4),
            amountBase: lineCost.toFixed(2),
          },
        });
      }
    });

    totalCost = Math.round((totalCost + Number.EPSILON) * 100) / 100;

    // Accounting: Dr 327 / Cr 150 (base TRY)
    if (totalCost > 0) {
      const accInv = await this.getAccountByCode('150');
      const accDebit = postedInv
      ? await this.getAccountByCode('328') // Purchase Returns Clearing (after-invoice)
      : await this.getAccountByCode('327');

      await this.accounting.createPostedFromIntegration(actor.sub, {
        documentDate: docDate,
        description: postedInv
        ? `Purchase return ${createdReturn.documentNo} (after invoice ${postedInv.documentNo}, SCN ${scn!.documentNo})`
        : `Purchase return ${createdReturn.documentNo} (pre-invoice)`,
        sourceType: 'PurchaseReturn',
        sourceId: createdReturn.id,
        lines: [
          {
            accountId: accDebit.id,
            partyId: receipt.po?.supplierId ?? null,
            description: postedInv
            ? `Purchase return clearing for ${createdReturn.documentNo}`
            : `Purchase return GRNI reversal for ${createdReturn.documentNo}`,
            debit: totalCost.toFixed(2),
            credit: '0',
            currencyCode: 'TRY',
            amountCurrency: totalCost.toFixed(2),
          },
          {
            accountId: accInv.id,
            partyId: receipt.po?.supplierId ?? null,
            description: `Purchase return ${createdReturn.documentNo} Inventory out`,
            debit: '0',
            credit: totalCost.toFixed(2),
            currencyCode: 'TRY',
            amountCurrency: totalCost.toFixed(2),
          },
        ],
      });
    }

    if (postedInv && scn && scn.status === SupplierInvoiceStatus.POSTED) {
      await this.ensureScnPurchaseReturnClearingJe({
        actorId: actor.sub,
        scnId: scn.id,
        scnDocumentNo: scn.documentNo,
        supplierId: receipt.po?.supplierId ?? null,
        documentDate: docDate,
      });
    }

    await this.audit.log({
      actorId: actor.sub,
      action: AuditAction.POST,
      entity: 'PurchaseReturn',
      entityId: createdReturn.id,
      after: { documentNo: createdReturn.documentNo, stockMoveId: move.id, totalCost: totalCost.toFixed(2) },
      message: `Created purchase return ${createdReturn.documentNo} for receipt ${receipt.documentNo}`,
    });

    return { purchaseReturnId: createdReturn.id, stockMoveId: move.id, totalCost: totalCost.toFixed(2) };
  }

  async getReceipt(id: string) {
    const r = await this.prisma.purchaseReceipt.findUnique({
      where: { id },
      include: { lines: true, po: true, warehouse: true },
    });
    if (!r) throw new NotFoundException('PurchaseReceipt not found');
    return r;
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

  private async getRateToTryAtPosting(poCurrency: string, poExchangeRateToBase: any, postingDate: Date): Promise<number> {
    const cur = poCurrency.toUpperCase();
    if (cur === 'TRY') return 1;

    // If PO has an explicit exchangeRateToBase, treat it as locked override (auditable)
    if (poExchangeRateToBase !== null && poExchangeRateToBase !== undefined) {
      const r = Number(poExchangeRateToBase);
      if (!Number.isFinite(r) || r <= 0) throw new BadRequestException('Invalid exchangeRateToBase on PO');
      return r;
    }

    // Otherwise pull CBRT daily rate via ExchangeRate table (Istanbul day)
    return this.fx.getRate(cur, 'TRY', postingDate);
  }

  async createSupplierInvoice(actorId: string, dto: any) {
    if (!dto.lines || dto.lines.length === 0) throw new BadRequestException('Invoice must have lines');

    const supplier = await this.prisma.party.findUnique({ where: { id: dto.supplierId } });
    if (!supplier || supplier.type !== PartyType.SUPPLIER) throw new BadRequestException('supplierId must be SUPPLIER');

    const cur = await this.prisma.currency.findUnique({ where: { code: dto.currencyCode.toUpperCase() } });
    if (!cur || !cur.isActive) throw new BadRequestException('Invalid currencyCode');

    if (dto.poId) {
      const po = await this.prisma.purchaseOrder.findUnique({ where: { id: dto.poId }, include: { lines: true } });
      if (!po) throw new BadRequestException('Invalid poId');

      const poLineIds = po.lines.map((l) => l.id);
      const poLineById = new Map(po.lines.map((l) => [l.id, l]));

      // received quantities per poLineId
      const recv = await this.prisma.purchaseReceiptLine.groupBy({
        by: ['poLineId'],
        where: { receipt: { poId: dto.poId } },
        _sum: { quantity: true },
      });
      const receivedByPoLineId = new Map<string, number>();
      for (const r of recv) receivedByPoLineId.set(r.poLineId, Number(r._sum.quantity ?? 0));

      // already invoiced quantities per poLineId (POSTED invoices only)
      const invAgg = await this.prisma.supplierInvoiceLine.groupBy({
        by: ['poLineId'],
        where: {
          poLineId: { in: poLineIds },
          invoice: { status: 'POSTED' as any },
        },
        _sum: { quantity: true },
      });
      const invoicedByPoLineId = new Map<string, number>();
      for (const r of invAgg) if (r.poLineId) invoicedByPoLineId.set(r.poLineId, Number(r._sum.quantity ?? 0));

      for (const l of dto.lines) {
        if (!l.poLineId) throw new BadRequestException('poLineId is required when poId is provided');

        const poLine = poLineById.get(l.poLineId);
        if (!poLine) throw new BadRequestException('Invalid poLineId for this PO');

        if (l.productId && l.productId !== poLine.productId) {
          throw new BadRequestException('Invoice line productId must match PO line productId');
        }

        const receivedQty = receivedByPoLineId.get(poLine.id) ?? 0;
        const alreadyInv = invoicedByPoLineId.get(poLine.id) ?? 0;
        const newQty = Number(l.quantity);

        if (alreadyInv + newQty > receivedQty + 1e-9) {
          throw new BadRequestException(`Invoicing exceeds received qty for poLineId=${poLine.id}`);
        }
      }
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

    // Calculate totals
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
        poLineId: dto.poId ? (l.poLineId ?? null) : null,
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
    const docNo = await this.docNo.allocate('SI', docDate);

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
  
  async createSupplierInvoiceNote(actor: JwtAccessPayload, dto: CreateSupplierInvoiceNoteDto) {
    if (dto.kind === InvoiceKind.INVOICE) {
      throw new BadRequestException('Supplier invoice note kind must be CREDIT_NOTE or DEBIT_NOTE');
    }
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('Supplier invoice note must have lines');
    }

    const base = await this.prisma.supplierInvoice.findUnique({
      where: { id: dto.noteOfId },
      include: { supplier: true, lines: true },
    });
    if (!base) throw new NotFoundException('Base supplier invoice not found');
    if (base.status !== 'POSTED') throw new BadRequestException('You can only issue notes against POSTED supplier invoices');

    // Determine if base invoice is PO-matched (GRNI model)
    const baseHasPoMatch = !!base.poId && base.lines.some((l: any) => !!l.poLineId);

    // If base is PO-matched, enforce poLineId on every note line (B1)
    const allowedPoLineIds = new Set<string>();
    if (baseHasPoMatch) {
      for (const l of base.lines) {
        if (l.poLineId) allowedPoLineIds.add(l.poLineId);
      }

      for (const nl of dto.lines) {
        if (!nl.poLineId) {
          throw new BadRequestException('poLineId is required for note lines when base invoice is PO-matched');
        }
        if (!allowedPoLineIds.has(nl.poLineId)) {
          throw new BadRequestException('Invalid poLineId for this noteOf invoice');
        }
      }
    }

    const docDate = dto.documentDate ? new Date(dto.documentDate) : new Date();
    const seqCode = dto.kind === InvoiceKind.CREDIT_NOTE ? 'SCN' : 'SDN';
    const docNo = await this.docNo.allocate(seqCode, docDate);

    const created = await this.prisma.supplierInvoice.create({
      data: {
        status: 'DRAFT',
        kind: dto.kind,
        noteOfId: base.id,
        noteReason: dto.reason,

        documentNo: docNo,
        documentDate: docDate,
        supplierId: base.supplierId,
        poId: base.poId,
        currencyCode: base.currencyCode,
        exchangeRateToBase: base.exchangeRateToBase,

        createdById: actor.sub,

        lines: {
          create: dto.lines.map((l) => {
            const qty = Number(l.quantity);
            const price = Number(l.unitPrice);
            const vatCode = l.vatCode as VatRateCode;

            const vatRate = vatRateFromCode(vatCode);
            const totals = computeLineTotals(qty, price, vatRate);

            return {
              // NEW: persist poLineId if base is PO-matched (or if client provided it)
              ...(l.poLineId ? { poLineId: l.poLineId } : {}),

              ...(l.productId ? { productId: l.productId } : {}),
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              vatCode,
              lineSubtotal: totals.lineSubtotal,
              lineVat: totals.lineVat,
              lineTotal: totals.lineTotal,
            };
          }),
        },
      },
      include: { lines: true },
    });

    await this.audit.log({
      actorId: actor.sub,
      action: AuditAction.CREATE,
      entity: 'SupplierInvoice',
      entityId: created.id,
      after: { kind: created.kind, documentNo: created.documentNo, noteOfId: created.noteOfId, baseHasPoMatch },
      message: `Created ${created.kind} ${created.documentNo} for supplier invoice ${base.documentNo}. Reason: ${dto.reason}`,
    });

    return created;
  }
  
  async postSupplierInvoice(actor: JwtAccessPayload, id: string, overrideReason?: string) {
    const inv = await this.prisma.supplierInvoice.findUnique({
      where: { id },
      include: { lines: true, supplier: true },
    });
    if (!inv) throw new NotFoundException('SupplierInvoice not found');
    if (inv.status !== SupplierInvoiceStatus.DRAFT) throw new BadRequestException('Only DRAFT invoices can be posted');

    await this.postingLock.assertPostingAllowed(
      actor,
      inv.documentDate,
      `Purchasing.postSupplierInvoice invoiceId=${inv.id}`,
      overrideReason,
    );

    const net = inv.lines.reduce((s, l) => s + Number(l.lineSubtotal), 0);
    const vat = inv.lines.reduce((s, l) => s + Number(l.lineVat), 0);
    const total = inv.lines.reduce((s, l) => s + Number(l.lineTotal), 0);

    const accAP = await this.getAccountByCode('320');
    const accVatIn = await this.getAccountByCode('191');
    const accExp = await this.getAccountByCode('770');
    const accGrni = await this.getAccountByCode('327');

    const isCredit = inv.kind === InvoiceKind.CREDIT_NOTE;

    // PO-matched invoice? => use GRNI model
    const hasPoMatch = !!inv.poId && inv.lines.some((l: any) => !!l.poLineId);

    const journalLines: any[] = [];

    if (hasPoMatch) {
      if (!isCredit) {
        // Dr GRNI (net), Dr VAT in, Cr AP (total)
        journalLines.push({
          accountId: accGrni.id,
          partyId: inv.supplierId,
          description: `${inv.kind} ${inv.documentNo} GRNI clearing`,
          debit: net.toFixed(2),
          credit: '0',
          currencyCode: inv.currencyCode,
          amountCurrency: net.toFixed(2),
        });
        journalLines.push({
          accountId: accVatIn.id,
          partyId: inv.supplierId,
          description: `${inv.kind} ${inv.documentNo} Deductible VAT`,
          debit: vat.toFixed(2),
          credit: '0',
          currencyCode: inv.currencyCode,
          amountCurrency: vat.toFixed(2),
        });
        journalLines.push({
          accountId: accAP.id,
          partyId: inv.supplierId,
          description: `${inv.kind} ${inv.documentNo} AP`,
          debit: '0',
          credit: total.toFixed(2),
          currencyCode: inv.currencyCode,
          amountCurrency: total.toFixed(2),
        });
      } else {
        // CREDIT_NOTE: Dr AP, Cr GRNI, Cr VAT
        journalLines.push({
          accountId: accAP.id,
          partyId: inv.supplierId,
          description: `${inv.kind} ${inv.documentNo} AP reversal`,
          debit: total.toFixed(2),
          credit: '0',
          currencyCode: inv.currencyCode,
          amountCurrency: total.toFixed(2),
        });
        journalLines.push({
          accountId: accGrni.id,
          partyId: inv.supplierId,
          description: `${inv.kind} ${inv.documentNo} GRNI reversal`,
          debit: '0',
          credit: net.toFixed(2),
          currencyCode: inv.currencyCode,
          amountCurrency: net.toFixed(2),
        });
        journalLines.push({
          accountId: accVatIn.id,
          partyId: inv.supplierId,
          description: `${inv.kind} ${inv.documentNo} VAT reversal`,
          debit: '0',
          credit: vat.toFixed(2),
          currencyCode: inv.currencyCode,
          amountCurrency: vat.toFixed(2),
        });
      }
    } else {
      // Unmatched/service model: 770/191/320
      if (!isCredit) {
        journalLines.push({
          accountId: accExp.id,
          partyId: inv.supplierId,
          description: `${inv.kind} ${inv.documentNo} Expense`,
          debit: net.toFixed(2),
          credit: '0',
          currencyCode: inv.currencyCode,
          amountCurrency: net.toFixed(2),
        });
        journalLines.push({
          accountId: accVatIn.id,
          partyId: inv.supplierId,
          description: `${inv.kind} ${inv.documentNo} Deductible VAT`,
          debit: vat.toFixed(2),
          credit: '0',
          currencyCode: inv.currencyCode,
          amountCurrency: vat.toFixed(2),
        });
        journalLines.push({
          accountId: accAP.id,
          partyId: inv.supplierId,
          description: `${inv.kind} ${inv.documentNo} AP`,
          debit: '0',
          credit: total.toFixed(2),
          currencyCode: inv.currencyCode,
          amountCurrency: total.toFixed(2),
        });
      } else {
        journalLines.push({
          accountId: accAP.id,
          partyId: inv.supplierId,
          description: `${inv.kind} ${inv.documentNo} AP reversal`,
          debit: total.toFixed(2),
          credit: '0',
          currencyCode: inv.currencyCode,
          amountCurrency: total.toFixed(2),
        });
        journalLines.push({
          accountId: accExp.id,
          partyId: inv.supplierId,
          description: `${inv.kind} ${inv.documentNo} Expense reversal`,
          debit: '0',
          credit: net.toFixed(2),
          currencyCode: inv.currencyCode,
          amountCurrency: net.toFixed(2),
        });
        journalLines.push({
          accountId: accVatIn.id,
          partyId: inv.supplierId,
          description: `${inv.kind} ${inv.documentNo} VAT reversal`,
          debit: '0',
          credit: vat.toFixed(2),
          currencyCode: inv.currencyCode,
          amountCurrency: vat.toFixed(2),
        });
      }
    }

    // 1) Post invoice + create main financial JE + persist journalEntryId relation
    const posted = await this.prisma.$transaction(async (tx) => {
      await tx.supplierInvoice.update({
        where: { id: inv.id },
        data: { status: 'POSTED', postedAt: new Date(), postedById: actor.sub },
      });

      const je = await this.accounting.createPostedFromIntegration(actor.sub, {
        documentDate: inv.documentDate,
        description: `${inv.kind} Supplier invoice ${inv.documentNo} posting`,
        sourceType: 'SupplierInvoice',
        sourceId: inv.id,
        lines: journalLines,
      });

      // Persist 1:1 link for GET /pur/invoices/:id include: { journalEntry: true }
      await tx.supplierInvoice.update({
        where: { id: inv.id },
        data: { journalEntryId: je.id },
      });

      return { je };
    });

    // 2) If SCN is used for purchase returns, create base TRY clearing JE: Dr 327 / Cr 328
    /*if (inv.kind === InvoiceKind.CREDIT_NOTE) {
      const linkedReturns = await this.prisma.purchaseReturn.findMany({
        where: { supplierCreditNoteId: inv.id },
        include: { lines: true },
      });

      if (linkedReturns.length) {
        const totalReturnBase = linkedReturns.reduce((sum, pr) => {
          const prTotal = pr.lines.reduce((s, l) => s + Number((l as any).lineCostBase ?? 0), 0);
          return sum + prTotal;
        }, 0);

        const amt = Math.round((totalReturnBase + Number.EPSILON) * 100) / 100;

        if (amt > 0) {
          const acc328 = await this.getAccountByCode('328');

          const je2 = await this.accounting.createPostedFromIntegration(actor.sub, {
            documentDate: inv.documentDate,
            description: `SCN ${inv.documentNo} clears Purchase Returns (Dr327/Cr328)`,
            sourceType: 'SupplierInvoice',
            sourceId: inv.id,
            lines: [
              {
                accountId: accGrni.id,
                partyId: inv.supplierId,
                description: `SCN ${inv.documentNo} base clearing debit`,
                debit: amt.toFixed(2),
                credit: '0',
                currencyCode: 'TRY',
                amountCurrency: amt.toFixed(2),
              },
              {
                accountId: acc328.id,
                partyId: inv.supplierId,
                description: `SCN ${inv.documentNo} clears Purchase Returns Clearing`,
                debit: '0',
                credit: amt.toFixed(2),
                currencyCode: 'TRY',
                amountCurrency: amt.toFixed(2),
              },
            ],
          });

          await this.audit.log({
            actorId: actor.sub,
            action: AuditAction.POST,
            entity: 'SupplierInvoice',
            entityId: inv.id,
            after: { purchaseReturnClearingJournalEntryId: je2.id, purchaseReturnClearingAmountBase: amt.toFixed(2) },
            message: `Posted SCN base clearing JE ${je2.documentNo} for ${inv.documentNo}`,
          });
        }
      }
    }*/

    if (inv.kind === InvoiceKind.CREDIT_NOTE) {
      await this.ensureScnPurchaseReturnClearingJe({
        actorId: actor.sub,
        scnId: inv.id,
        scnDocumentNo: inv.documentNo,
        supplierId: inv.supplierId,
        documentDate: inv.documentDate,
      });
    }

    await this.audit.log({
      actorId: actor.sub,
      action: AuditAction.POST,
      entity: 'SupplierInvoice',
      entityId: inv.id,
      after: { status: 'POSTED', journalEntryId: posted.je.id, hasPoMatch },
      message: overrideReason
        ? `Posted Supplier Invoice ${inv.kind} ${inv.documentNo} (override reason: ${overrideReason}) and created JE ${posted.je.documentNo}`
        : `Posted Supplier Invoice ${inv.kind} ${inv.documentNo} and created JE ${posted.je.documentNo}`,
    });

    return { ok: true, journalEntryId: posted.je.id };
  }

  async getSupplierInvoice(id: string) {
    const inv = await this.prisma.supplierInvoice.findUnique({
      where: { id },
      include: { lines: true, supplier: true, po: true, journalEntry: true },
    });
    if (!inv) throw new NotFoundException('SupplierInvoice not found');
    return inv;
  }

  async getPurchaseReturn(id: string) {
    const pr = await this.prisma.purchaseReturn.findUnique({
      where: { id },
      include: { lines: true, receipt: true, supplierCreditNote: true, stockMove: true },
    });
    if (!pr) throw new NotFoundException('PurchaseReturn not found');
    return pr;
  }
}
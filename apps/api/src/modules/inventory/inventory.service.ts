import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingLockService } from '../finance/posting-lock.service';
import { JwtAccessPayload } from '../../common/types/auth.types';
import { AuditAction, StockMoveStatus, StockMoveType } from '@prisma/client';
import { DocNoService } from '../common/sequence/docno.service';
import { FifoService } from './costing/fifo.service';
import { AccountingService } from '../accounting/accounting.service';

function isString(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0;
}

function numOrNaN(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : Number.NaN;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly postingLock: PostingLockService,
    private readonly docNo: DocNoService,
    private readonly fifo: FifoService,
    private readonly accounting: AccountingService,
  ) {}

  async listMoves() {
    return this.prisma.stockMove.findMany({
      orderBy: { createdAt: 'desc' },
      include: { lines: true, fromWarehouse: true, toWarehouse: true },
      take: 100,
    });
  }

  async getMove(id: string) {
    const move = await this.prisma.stockMove.findUnique({
      where: { id },
      include: { lines: true, fromWarehouse: true, toWarehouse: true, ledgerEntries: true },
    });
    if (!move) throw new NotFoundException('StockMove not found');
    return move;
  }

  private validateWarehouses(type: StockMoveType, fromId?: string, toId?: string) {
    if (type === 'RECEIPT') {
      if (!toId) throw new BadRequestException('toWarehouseId required for RECEIPT');
    }
    if (type === 'ISSUE') {
      if (!fromId) throw new BadRequestException('fromWarehouseId required for ISSUE');
    }
    if (type === 'TRANSFER') {
      if (!fromId || !toId)
        throw new BadRequestException('fromWarehouseId and toWarehouseId required for TRANSFER');
      if (fromId === toId)
        throw new BadRequestException('fromWarehouseId and toWarehouseId cannot be same');
    }
    if (type === 'ADJUSTMENT') {
      if (!toId && !fromId)
        throw new BadRequestException('fromWarehouseId or toWarehouseId required for ADJUSTMENT');
      if (fromId && toId)
        throw new BadRequestException('ADJUSTMENT must use only one warehouse (from OR to)');
    }
  }

  async createMove(actorId: string, dto: any) {
    const documentDate = dto.documentDate ? new Date(dto.documentDate) : new Date();
    this.validateWarehouses(dto.type, dto.fromWarehouseId, dto.toWarehouseId);

    if (!dto.lines || dto.lines.length === 0)
      throw new BadRequestException('At least one line is required');

    if (dto.fromWarehouseId) {
      const w = await this.prisma.warehouse.findUnique({ where: { id: dto.fromWarehouseId } });
      if (!w || !w.isActive) throw new BadRequestException('Invalid fromWarehouseId');
    }
    if (dto.toWarehouseId) {
      const w = await this.prisma.warehouse.findUnique({ where: { id: dto.toWarehouseId } });
      if (!w || !w.isActive) throw new BadRequestException('Invalid toWarehouseId');
    }

    const isInboundValued =
      dto.type === 'RECEIPT' || (dto.type === 'ADJUSTMENT' && !!dto.toWarehouseId);

    for (const l of dto.lines) {
      if (Number(l.quantity) <= 0) throw new BadRequestException('Line quantity must be > 0');

      const p = await this.prisma.product.findUnique({ where: { id: l.productId } });
      if (!p || !p.isActive) throw new BadRequestException('Invalid productId');

      const u = await this.prisma.unit.findUnique({ where: { id: l.unitId } });
      if (!u) throw new BadRequestException('Invalid unitId');

      // ✅ Professional rule set: inbound valued moves must carry unitCostBase (>0)
      if (isInboundValued) {
        const unitCostBase = numOrNaN(l.unitCostBase);
        if (!Number.isFinite(unitCostBase) || unitCostBase <= 0) {
          throw new BadRequestException('Inbound move lines require unitCostBase > 0');
        }

        const ccy = isString(l.sourceCurrencyCode) ? String(l.sourceCurrencyCode).toUpperCase().trim() : '';
        if (ccy) {
          if (ccy.length !== 3) throw new BadRequestException('sourceCurrencyCode must be 3 letters');
          const unitCostTxn = numOrNaN(l.unitCostTxn);
          const fx = numOrNaN(l.fxRateToTry);
          if (!Number.isFinite(unitCostTxn) || unitCostTxn <= 0) {
            throw new BadRequestException('unitCostTxn must be > 0 when sourceCurrencyCode is provided');
          }
          if (!Number.isFinite(fx) || fx <= 0) {
            throw new BadRequestException('fxRateToTry must be > 0 when sourceCurrencyCode is provided');
          }
        }
      }
    }

    const docNo = await this.docNo.allocate('MOV', documentDate);

    const created = await this.prisma.stockMove.create({
      data: {
        type: dto.type,
        status: StockMoveStatus.DRAFT,
        documentNo: docNo,
        documentDate,
        notes: dto.notes,
        fromWarehouseId: dto.fromWarehouseId ?? null,
        toWarehouseId: dto.toWarehouseId ?? null,
        createdById: actorId,
        lines: {
          create: dto.lines.map((l: any) => ({
            productId: l.productId,
            unitId: l.unitId,
            quantity: l.quantity,
            notes: l.notes,
            lotNo: l.lotNo,
            serialNo: l.serialNo,

            sourceCurrencyCode: l.sourceCurrencyCode ?? null,
            unitCostTxn: l.unitCostTxn ?? null,
            fxRateToTry: l.fxRateToTry ?? null,
            unitCostBase: l.unitCostBase ?? null,
          })),
        },
      },
      include: { lines: true },
    });

    await this.audit.log({
      actorId,
      action: AuditAction.CREATE,
      entity: 'StockMove',
      entityId: created.id,
      after: {
        id: created.id,
        documentNo: created.documentNo,
        type: created.type,
        status: created.status,
      },
      message: `Created stock move ${created.documentNo}`,
    });

    return created;
  }

  async getOnHand(params: { warehouseId?: string; productId?: string }) {
    const rows = await this.prisma.stockLedgerEntry.groupBy({
      by: ['productId', 'warehouseId'],
      where: {
        warehouseId: params.warehouseId,
        productId: params.productId,
      },
      _sum: {
        quantityIn: true,
        quantityOut: true,
      },
    });

    return rows.map((r) => ({
      productId: r.productId,
      warehouseId: r.warehouseId,
      onHand: (Number(r._sum.quantityIn ?? 0) - Number(r._sum.quantityOut ?? 0)).toFixed(4),
    }));
  }

  async stockValuation(params: {
    asOf?: string;
    warehouseId?: string;
    productId?: string;
    groupBy?: 'product' | 'warehouseProduct' | 'productWarehouse';
  }) {
    const asOf = params.asOf ? new Date(`${params.asOf}T23:59:59.999Z`) : new Date();
    if (Number.isNaN(asOf.getTime())) throw new BadRequestException('Invalid asOf');

    const groupBy = params.groupBy ?? 'product';

    const rows = await (this.prisma as any).$queryRaw<
      Array<{
        productId: string;
        warehouseId: string;
        qtyRemain: any;
        unitCostBase: any;
        receivedAt: Date;
      }>
    >`
      SELECT
        "productId",
        "warehouseId",
        "qtyRemain",
        "unitCostBase",
        "receivedAt"
      FROM "InventoryFifoLayer"
      WHERE "qtyRemain" > 0
        AND "receivedAt" <= ${asOf}
        AND (${params.warehouseId ?? null}::text IS NULL OR "warehouseId" = ${params.warehouseId})
        AND (${params.productId ?? null}::text IS NULL OR "productId" = ${params.productId})
    `;

    type Agg = {
      productId: string;
      warehouseId: string | null;
      qty: number;
      value: number;
    };

    const agg = new Map<string, Agg>();

    for (const r of rows) {
      const qty = Number(r.qtyRemain ?? 0);
      const unit = Number(r.unitCostBase ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      if (!Number.isFinite(unit) || unit <= 0) continue;

      const wh = groupBy === 'product' ? null : r.warehouseId;

      const key = groupBy === 'product' ? `${r.productId}` : `${r.productId}::${r.warehouseId}`;

      const cur = agg.get(key) ?? { productId: r.productId, warehouseId: wh, qty: 0, value: 0 };
      cur.qty += qty;
      cur.value += qty * unit;
      agg.set(key, cur);
    }

    const items = Array.from(agg.values()).map((x) => {
      const avg = x.qty > 0 ? x.value / x.qty : 0;
      return {
        productId: x.productId,
        warehouseId: x.warehouseId,
        qtyOnHand: x.qty.toFixed(4),
        valuationBase: (Math.round((x.value + Number.EPSILON) * 100) / 100).toFixed(2),
        avgCostBase: (Math.round((avg + Number.EPSILON) * 1000000) / 1000000).toFixed(6),
        currencyCode: 'TRY' as const,
      };
    });

    const productIds = [...new Set(items.map((i) => i.productId))];
    const whIds = [...new Set(items.map((i) => i.warehouseId).filter(Boolean) as string[])];

    const [products, warehouses] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, sku: true, name: true },
      }),
      this.prisma.warehouse.findMany({
        where: { id: { in: whIds } },
        select: { id: true, code: true, name: true },
      }),
    ]);

    const pMap = new Map(products.map((p) => [p.id, p]));
    const wMap = new Map(warehouses.map((w) => [w.id, w]));

    const enriched = items
      .map((i) => ({
        ...i,
        productCode: (pMap.get(i.productId) as any)?.sku ?? '',
        productName: (pMap.get(i.productId) as any)?.name ?? '',
        warehouseCode: i.warehouseId ? (wMap.get(i.warehouseId)?.code ?? '') : '',
        warehouseName: i.warehouseId ? (wMap.get(i.warehouseId)?.name ?? '') : '',
      }))
      .sort((a, b) => {
        if (groupBy === 'warehouseProduct') {
          return (a.warehouseCode + a.productCode).localeCompare(b.warehouseCode + b.productCode);
        }
        if (groupBy === 'productWarehouse') {
          return (a.productCode + a.warehouseCode).localeCompare(b.productCode + b.warehouseCode);
        }
        return a.productCode.localeCompare(b.productCode);
      });

    const totalValue = enriched.reduce((s, r) => s + Number(r.valuationBase), 0);

    return {
      ok: true,
      asOf: asOf.toISOString(),
      groupBy,
      filters: {
        warehouseId: params.warehouseId ?? null,
        productId: params.productId ?? null,
      },
      totals: {
        currencyCode: 'TRY',
        valuationBase: totalValue.toFixed(2),
        lines: enriched.length,
      },
      rows: enriched,
    };
  }

  async stockValuationLayers(params: { asOf?: string; warehouseId?: string; productId?: string }) {
    const asOf = params.asOf ? new Date(`${params.asOf}T23:59:59.999Z`) : new Date();
    if (Number.isNaN(asOf.getTime())) throw new BadRequestException('Invalid asOf');

    if (!params.productId && !params.warehouseId) {
      throw new BadRequestException('Provide productId or warehouseId for layer drilldown');
    }

    const layers = await (this.prisma as any).inventoryFifoLayer.findMany({
      where: {
        productId: params.productId ?? undefined,
        warehouseId: params.warehouseId ?? undefined,
        receivedAt: { lte: asOf },
        qtyRemain: { gt: '0' },
      },
      orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    });

    return {
      ok: true,
      asOf: asOf.toISOString(),
      filters: { warehouseId: params.warehouseId ?? null, productId: params.productId ?? null },
      count: layers.length,
      layers,
    };
  }

  private async assertSufficientStock(warehouseId: string, productId: string, requiredOut: number) {
    const allowNegative = (this.config.get<string>('ALLOW_NEGATIVE_STOCK') ?? 'false') === 'true';
    if (allowNegative) return;

    const sums = await this.prisma.stockLedgerEntry.aggregate({
      where: { warehouseId, productId },
      _sum: { quantityIn: true, quantityOut: true },
    });
    const onHand = Number(sums._sum.quantityIn ?? 0) - Number(sums._sum.quantityOut ?? 0);
    if (onHand + 1e-9 < requiredOut) {
      throw new ForbiddenException(
        `Insufficient stock for product ${productId}. On-hand=${onHand}, required=${requiredOut}`,
      );
    }
  }

  async postMove(actor: JwtAccessPayload, id: string, notes?: string, overrideReason?: string) {
    const move = await this.prisma.stockMove.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!move) throw new NotFoundException('StockMove not found');
    if (move.status !== StockMoveStatus.DRAFT)
      throw new BadRequestException('Only DRAFT moves can be posted');

    await this.postingLock.assertPostingAllowed(
      actor,
      move.documentDate,
      `Inventory.postMove moveId=${move.id}`,
      overrideReason,
    );
    this.validateWarehouses(
      move.type,
      move.fromWarehouseId ?? undefined,
      move.toWarehouseId ?? undefined,
    );

    if (move.type === 'ISSUE' || move.type === 'TRANSFER') {
      const fromId = move.fromWarehouseId!;
      for (const l of move.lines) {
        await this.assertSufficientStock(fromId, l.productId, Number(l.quantity));
      }
    }
    if (move.type === 'ADJUSTMENT' && move.fromWarehouseId) {
      const fromId = move.fromWarehouseId;
      for (const l of move.lines) {
        await this.assertSufficientStock(fromId, l.productId, Number(l.quantity));
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.stockMove.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!locked) throw new NotFoundException('StockMove not found');
      if (locked.status !== StockMoveStatus.DRAFT)
        throw new BadRequestException('Move already posted/canceled');

      const ledgerCreates: any[] = [];

      for (const l of locked.lines) {
        if (locked.type === 'RECEIPT') {
          ledgerCreates.push({
            moveId: id,
            productId: l.productId,
            warehouseId: locked.toWarehouseId!,
            quantityIn: l.quantity,
            quantityOut: '0',
          });
        } else if (locked.type === 'ISSUE') {
          ledgerCreates.push({
            moveId: id,
            productId: l.productId,
            warehouseId: locked.fromWarehouseId!,
            quantityIn: '0',
            quantityOut: l.quantity,
          });
        } else if (locked.type === 'TRANSFER') {
          ledgerCreates.push({
            moveId: id,
            productId: l.productId,
            warehouseId: locked.fromWarehouseId!,
            quantityIn: '0',
            quantityOut: l.quantity,
          });
          ledgerCreates.push({
            moveId: id,
            productId: l.productId,
            warehouseId: locked.toWarehouseId!,
            quantityIn: l.quantity,
            quantityOut: '0',
          });
        } else if (locked.type === 'ADJUSTMENT') {
          if (locked.toWarehouseId) {
            ledgerCreates.push({
              moveId: id,
              productId: l.productId,
              warehouseId: locked.toWarehouseId,
              quantityIn: l.quantity,
              quantityOut: '0',
            });
          } else if (locked.fromWarehouseId) {
            ledgerCreates.push({
              moveId: id,
              productId: l.productId,
              warehouseId: locked.fromWarehouseId,
              quantityIn: '0',
              quantityOut: l.quantity,
            });
          }
        }
      }

      await tx.stockLedgerEntry.createMany({ data: ledgerCreates });

      // ✅ EXACT PLACE: after ledger entries are created, before move is marked POSTED
      // Create FIFO inbound layers for valued inbound moves.
      if (locked.type === 'RECEIPT' || (locked.type === 'ADJUSTMENT' && locked.toWarehouseId)) {
        const inboundWarehouseId = locked.toWarehouseId!;

        for (const l of locked.lines as any[]) {
          const qtyIn = Number(l.quantity);
          if (!Number.isFinite(qtyIn) || qtyIn <= 0) continue;

          const unitCostBase = Number(l.unitCostBase ?? 0);
          if (!Number.isFinite(unitCostBase) || unitCostBase <= 0) {
            throw new BadRequestException(
              `Missing unitCostBase for inbound move line ${l.id}. Provide unit cost before posting.`,
            );
          }

          await this.fifo.createInboundLayer(tx as any, {
            productId: l.productId,
            warehouseId: inboundWarehouseId,
            sourceType: 'StockMove',
            sourceId: locked.id,
            sourceLineId: l.id,
            receivedAt: locked.documentDate,
            qtyIn,
            unitCostBase,

            sourceCurrencyCode: l.sourceCurrencyCode ?? null,
            unitCostTxn: l.unitCostTxn === null || l.unitCostTxn === undefined ? null : Number(l.unitCostTxn),
            fxRateToTry: l.fxRateToTry === null || l.fxRateToTry === undefined ? null : Number(l.fxRateToTry),
          });
        }
      }

            // =========================
      // Valuation + Accounting JE (professional)
      // =========================
      // Idempotency: if a POSTED JE already exists for this StockMove, do not create another.
      const existingJe = await (tx as any).journalEntry.findFirst({
        where: { status: 'POSTED', sourceType: 'StockMove', sourceId: locked.id },
        select: { id: true },
      });

      // Build valuation totals (base currency = TRY)
      let totalInBase = 0;
      let totalOutBase = 0;

      // A) Inbound valuation from unitCostBase on lines
      if (locked.type === 'RECEIPT' || (locked.type === 'ADJUSTMENT' && locked.toWarehouseId)) {
        for (const l of locked.lines as any[]) {
          const qtyIn = Number(l.quantity);
          if (!Number.isFinite(qtyIn) || qtyIn <= 0) continue;

          const unitCostBase = Number(l.unitCostBase ?? 0);
          if (!Number.isFinite(unitCostBase) || unitCostBase <= 0) {
            throw new BadRequestException(
              `Missing unitCostBase for inbound move line ${l.id}. Provide unit cost before posting.`,
            );
          }

          const amountBase = Math.round((qtyIn * unitCostBase + Number.EPSILON) * 100) / 100;
          totalInBase += amountBase;

          // Store valuation entry row (audit + reporting)
          await (tx as any).inventoryValuationEntry.create({
            data: {
              productId: l.productId,
              warehouseId: locked.toWarehouseId!,
              sourceType: 'StockMove',
              sourceId: locked.id,
              sourceLineId: l.id,
              method: 'FIFO',
              quantityIn: qtyIn.toFixed(4),
              quantityOut: '0',
              amountBase: amountBase.toFixed(2),
            },
          });
        }
      }

      // B) Outbound valuation from FIFO allocations (consistent with sales delivery costing)
      if (locked.type === 'ISSUE' || (locked.type === 'ADJUSTMENT' && locked.fromWarehouseId)) {
        for (const l of locked.lines as any[]) {
          const qtyOut = Number(l.quantity);
          if (!Number.isFinite(qtyOut) || qtyOut <= 0) continue;

          const alloc = await this.fifo.allocateOutbound(tx as any, {
            productId: l.productId,
            warehouseId: locked.fromWarehouseId!,
            issueSourceType: 'StockMove',
            issueSourceId: locked.id,
            issueSourceLineId: l.id,
            qtyOut,
          });

          const amountBase = Math.round((Number(alloc.totalAmountBase ?? 0) + Number.EPSILON) * 100) / 100;
          totalOutBase += amountBase;

          await (tx as any).inventoryValuationEntry.create({
            data: {
              productId: l.productId,
              warehouseId: locked.fromWarehouseId!,
              sourceType: 'StockMove',
              sourceId: locked.id,
              sourceLineId: l.id,
              method: 'FIFO',
              quantityIn: '0',
              quantityOut: qtyOut.toFixed(4),
              amountBase: amountBase.toFixed(2),
            },
          });
        }
      }

      totalInBase = Math.round((totalInBase + Number.EPSILON) * 100) / 100;
      totalOutBase = Math.round((totalOutBase + Number.EPSILON) * 100) / 100;

      // Create JE only once
      if (!existingJe && (totalInBase > 0 || totalOutBase > 0)) {
        const accInv = await tx.account.findUnique({ where: { code: '150' } });
        const accReceiptClr = await tx.account.findUnique({ where: { code: '501' } });
        const accAdjGain = await tx.account.findUnique({ where: { code: '679' } });
        const accAdjLoss = await tx.account.findUnique({ where: { code: '689' } });

        if (!accInv || !accReceiptClr || !accAdjGain || !accAdjLoss) {
          throw new BadRequestException(
            'Missing required accounts for StockMove valuation (150, 501, 679, 689). Run seed/migrations.',
          );
        }

        const lines: any[] = [];

        // RECEIPT: Dr Inventory / Cr Receipt Clearing
        if (locked.type === 'RECEIPT' && totalInBase > 0) {
          lines.push(
            {
              accountId: accInv.id,
              description: `Stock receipt ${locked.documentNo} inventory`,
              debit: totalInBase.toFixed(2),
              credit: '0',
              currencyCode: 'TRY',
              amountCurrency: totalInBase.toFixed(2),
            },
            {
              accountId: accReceiptClr.id,
              description: `Stock receipt ${locked.documentNo} clearing`,
              debit: '0',
              credit: totalInBase.toFixed(2),
              currencyCode: 'TRY',
              amountCurrency: totalInBase.toFixed(2),
            },
          );
        }

        // ADJUSTMENT IN: Dr Inventory / Cr Adjustment Gain
        if (locked.type === 'ADJUSTMENT' && locked.toWarehouseId && totalInBase > 0) {
          lines.push(
            {
              accountId: accInv.id,
              description: `Stock adjustment IN ${locked.documentNo} inventory`,
              debit: totalInBase.toFixed(2),
              credit: '0',
              currencyCode: 'TRY',
              amountCurrency: totalInBase.toFixed(2),
            },
            {
              accountId: accAdjGain.id,
              description: `Stock adjustment IN ${locked.documentNo} gain`,
              debit: '0',
              credit: totalInBase.toFixed(2),
              currencyCode: 'TRY',
              amountCurrency: totalInBase.toFixed(2),
            },
          );
        }

        // ISSUE: Dr Receipt Clearing (placeholder offset) / Cr Inventory
        // ADJUSTMENT OUT: Dr Adjustment Loss / Cr Inventory
        if ((locked.type === 'ISSUE' || (locked.type === 'ADJUSTMENT' && locked.fromWarehouseId)) && totalOutBase > 0) {
          const debitAccId = locked.type === 'ADJUSTMENT' ? accAdjLoss.id : accReceiptClr.id;

          lines.push(
            {
              accountId: debitAccId,
              description: `${locked.type} ${locked.documentNo} offset`,
              debit: totalOutBase.toFixed(2),
              credit: '0',
              currencyCode: 'TRY',
              amountCurrency: totalOutBase.toFixed(2),
            },
            {
              accountId: accInv.id,
              description: `${locked.type} ${locked.documentNo} inventory`,
              debit: '0',
              credit: totalOutBase.toFixed(2),
              currencyCode: 'TRY',
              amountCurrency: totalOutBase.toFixed(2),
            },
          );
        }

        // Balance guard
        const dr = lines.reduce((s, l) => s + Number(l.debit), 0);
        const cr = lines.reduce((s, l) => s + Number(l.credit), 0);
        if (Math.abs(dr - cr) > 0.005) {
          throw new BadRequestException('StockMove valuation JE not balanced');
        }

        // Centralized JE creation (already posts)
        const je = await this.accounting.createPostedFromIntegration(actor.sub, {
          documentDate: locked.documentDate,
          description: `StockMove valuation ${locked.documentNo} (${locked.type})`,
          sourceType: 'StockMove',
          sourceId: locked.id,
          lines,
        });

        await this.audit.log({
          actorId: actor.sub,
          action: AuditAction.POST,
          entity: 'StockMove',
          entityId: locked.id,
          after: { journalEntryId: je.id, totalInBase: totalInBase.toFixed(2), totalOutBase: totalOutBase.toFixed(2) },
          message: `Created valuation JE for stock move ${locked.documentNo}`,
        });
      }

      const updated = await tx.stockMove.update({
        where: { id },
        data: {
          status: StockMoveStatus.POSTED,
          postedAt: new Date(),
          postedById: actor.sub,
          notes: notes ?? locked.notes,
        },
      });

      return updated;
    });

    await this.audit.log({
      actorId: actor.sub,
      action: AuditAction.POST,
      entity: 'StockMove',
      entityId: id,
      after: { status: result.status, postedAt: result.postedAt, postedById: result.postedById },
      message: overrideReason
        ? `Posted stock move ${move.documentNo} (override reason: ${overrideReason})`
        : `Posted stock move ${move.documentNo}`,
    });

    return { ok: true };
  }

  async cancelMove(actorId: string, id: string) {
    const move = await this.prisma.stockMove.findUnique({ where: { id } });
    if (!move) throw new NotFoundException('StockMove not found');
    if (move.status !== StockMoveStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT moves can be canceled');
    }

    const updated = await this.prisma.stockMove.update({
      where: { id },
      data: { status: StockMoveStatus.CANCELED },
    });

    await this.audit.log({
      actorId,
      action: AuditAction.CANCEL,
      entity: 'StockMove',
      entityId: id,
      after: { status: updated.status },
      message: `Canceled stock move ${move.documentNo}`,
    });

    return { ok: true };
  }

  async reverseMove(actorId: string, id: string) {
    const move = await this.prisma.stockMove.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!move) throw new NotFoundException('StockMove not found');
    if (move.status !== StockMoveStatus.POSTED) {
      throw new BadRequestException('Only POSTED moves can be reversed');
    }

    let reversalType: StockMoveType = move.type;
    let fromWarehouseId: string | null = move.fromWarehouseId;
    let toWarehouseId: string | null = move.toWarehouseId;

    if (move.type === 'RECEIPT') {
      reversalType = StockMoveType.ISSUE;
      fromWarehouseId = move.toWarehouseId;
      toWarehouseId = null;
    } else if (move.type === 'ISSUE') {
      reversalType = StockMoveType.RECEIPT;
      fromWarehouseId = null;
      toWarehouseId = move.fromWarehouseId;
    } else if (move.type === 'TRANSFER') {
      reversalType = StockMoveType.TRANSFER;
      fromWarehouseId = move.toWarehouseId;
      toWarehouseId = move.fromWarehouseId;
    } else if (move.type === 'ADJUSTMENT') {
      reversalType = StockMoveType.ADJUSTMENT;
      fromWarehouseId = move.toWarehouseId;
      toWarehouseId = move.fromWarehouseId;
    }

    const docNo = await this.docNo.allocate('MOV', new Date());

    const created = await this.prisma.stockMove.create({
      data: {
        type: reversalType,
        status: StockMoveStatus.DRAFT,
        documentNo: docNo,
        documentDate: new Date(),
        notes: `Reversal of ${move.documentNo}`,
        fromWarehouseId,
        toWarehouseId,
        createdById: actorId,
        lines: {
          create: move.lines.map((l) => ({
            productId: l.productId,
            unitId: l.unitId,
            quantity: l.quantity,
            notes: `Reversal line of ${l.id}`,
            lotNo: l.lotNo,
            serialNo: l.serialNo,
          })),
        },
      },
      include: { lines: true },
    });

    await this.audit.log({
      actorId,
      action: AuditAction.CREATE,
      entity: 'StockMove',
      entityId: created.id,
      after: { id: created.id, documentNo: created.documentNo, notes: created.notes },
      message: `Created reversal move ${created.documentNo} for ${move.documentNo}`,
    });

    return created;
  }

  async fifoAllocations(params: {
    issueSourceType?: string;
    issueSourceId?: string;
    issueSourceLineId?: string;
  }) {
    const t = params.issueSourceType?.trim();
    const id = params.issueSourceId?.trim();
    const lineId = params.issueSourceLineId?.trim();

    if (!t || !id) {
      throw new BadRequestException('issueSourceType and issueSourceId are required');
    }

    const where: any = {
      issueSourceType: t,
      issueSourceId: id,
    };
    if (lineId) where.issueSourceLineId = lineId;

    const rows = await this.prisma.inventoryFifoAllocation.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }],
      include: {
        layer: true,
      },
      take: 2000,
    });

    const productIds = Array.from(new Set(rows.map((r) => r.productId)));
    const whIds = Array.from(new Set(rows.map((r) => r.warehouseId)));

    const [products, warehouses] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, sku: true, name: true },
      }),
      this.prisma.warehouse.findMany({
        where: { id: { in: whIds } },
        select: { id: true, code: true, name: true },
      }),
    ]);

    const pMap = new Map(products.map((p) => [p.id, p]));
    const wMap = new Map(warehouses.map((w) => [w.id, w]));

    const mapped = rows.map((r: any) => ({
      id: r.id,
      createdAt: r.createdAt,
      productId: r.productId,
      productSku: (pMap.get(r.productId) as any)?.sku ?? '',
      productName: (pMap.get(r.productId) as any)?.name ?? '',
      warehouseId: r.warehouseId,
      warehouseCode: wMap.get(r.warehouseId)?.code ?? '',
      warehouseName: wMap.get(r.warehouseId)?.name ?? '',

      issueSourceType: r.issueSourceType,
      issueSourceId: r.issueSourceId,
      issueSourceLineId: r.issueSourceLineId,

      quantity: r.quantity,
      unitCostBase: r.unitCostBase,
      amountBase: r.amountBase,

      layer: {
        id: r.layer?.id,
        receivedAt: r.layer?.receivedAt,
        sourceType: r.layer?.sourceType,
        sourceId: r.layer?.sourceId,
        sourceLineId: r.layer?.sourceLineId,
        qtyIn: r.layer?.qtyIn,
        qtyRemain: r.layer?.qtyRemain,
        unitCostBase: r.layer?.unitCostBase,

        sourceCurrencyCode: r.layer?.sourceCurrencyCode ?? null,
        unitCostTxn: r.layer?.unitCostTxn ?? null,
        fxRateToTry: r.layer?.fxRateToTry ?? null,
      },
    }));

    const total = mapped.reduce((s: number, x: any) => s + Number(x.amountBase ?? 0), 0);

    return {
      ok: true,
      filters: { issueSourceType: t, issueSourceId: id, issueSourceLineId: lineId ?? null },
      totals: { currencyCode: 'TRY', amountBase: total.toFixed(2), lines: mapped.length },
      rows: mapped,
    };
  }
}
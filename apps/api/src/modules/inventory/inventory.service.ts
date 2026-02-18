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

function isString(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly postingLock: PostingLockService,
    private readonly docNo: DocNoService,
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

    for (const l of dto.lines) {
      if (Number(l.quantity) <= 0) throw new BadRequestException('Line quantity must be > 0');
      const p = await this.prisma.product.findUnique({ where: { id: l.productId } });
      if (!p || !p.isActive) throw new BadRequestException('Invalid productId');
      const u = await this.prisma.unit.findUnique({ where: { id: l.unitId } });
      if (!u) throw new BadRequestException('Invalid unitId');
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

      const wh =
        groupBy === 'product'
          ? null
          : r.warehouseId;

      const key =
        groupBy === 'product'
          ? `${r.productId}`
          : `${r.productId}::${r.warehouseId}`;

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
        // perfect professional sorting
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
      const locked = await tx.stockMove.findUnique({ where: { id } });
      if (!locked) throw new NotFoundException('StockMove not found');
      if (locked.status !== StockMoveStatus.DRAFT)
        throw new BadRequestException('Move already posted/canceled');

      const ledgerCreates: any[] = [];

      for (const l of move.lines) {
        if (move.type === 'RECEIPT') {
          ledgerCreates.push({
            moveId: id,
            productId: l.productId,
            warehouseId: move.toWarehouseId!,
            quantityIn: l.quantity,
            quantityOut: '0',
          });
        } else if (move.type === 'ISSUE') {
          ledgerCreates.push({
            moveId: id,
            productId: l.productId,
            warehouseId: move.fromWarehouseId!,
            quantityIn: '0',
            quantityOut: l.quantity,
          });
        } else if (move.type === 'TRANSFER') {
          ledgerCreates.push({
            moveId: id,
            productId: l.productId,
            warehouseId: move.fromWarehouseId!,
            quantityIn: '0',
            quantityOut: l.quantity,
          });
          ledgerCreates.push({
            moveId: id,
            productId: l.productId,
            warehouseId: move.toWarehouseId!,
            quantityIn: l.quantity,
            quantityOut: '0',
          });
        } else if (move.type === 'ADJUSTMENT') {
          if (move.toWarehouseId) {
            ledgerCreates.push({
              moveId: id,
              productId: l.productId,
              warehouseId: move.toWarehouseId,
              quantityIn: l.quantity,
              quantityOut: '0',
            });
          } else if (move.fromWarehouseId) {
            ledgerCreates.push({
              moveId: id,
              productId: l.productId,
              warehouseId: move.fromWarehouseId,
              quantityIn: '0',
              quantityOut: l.quantity,
            });
          }
        }
      }

      await tx.stockLedgerEntry.createMany({ data: ledgerCreates });

      const updated = await tx.stockMove.update({
        where: { id },
        data: {
          status: StockMoveStatus.POSTED,
          postedAt: new Date(),
          postedById: actor.sub,
          notes: notes ?? move.notes,
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
        layer: true, // contains currency audit fields after migration
      },
      take: 2000,
    });

    // Enrich with product/warehouse labels
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
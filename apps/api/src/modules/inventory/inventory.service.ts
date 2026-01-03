import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingLockService } from '../finance/posting-lock.service';
import { JwtAccessPayload } from '../../common/types/auth.types';
import { AuditAction, StockMoveStatus, StockMoveType } from '@prisma/client';
import { DocNoService } from '../common/sequence/docno.service';

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
      if (!fromId || !toId) throw new BadRequestException('fromWarehouseId and toWarehouseId required for TRANSFER');
      if (fromId === toId) throw new BadRequestException('fromWarehouseId and toWarehouseId cannot be same');
    }
    if (type === 'ADJUSTMENT') {
      if (!toId && !fromId) throw new BadRequestException('fromWarehouseId or toWarehouseId required for ADJUSTMENT');
      if (fromId && toId) throw new BadRequestException('ADJUSTMENT must use only one warehouse (from OR to)');
    }
  }

  async createMove(actorId: string, dto: any) {
    const documentDate = dto.documentDate ? new Date(dto.documentDate) : new Date();
    this.validateWarehouses(dto.type, dto.fromWarehouseId, dto.toWarehouseId);

    if (!dto.lines || dto.lines.length === 0) throw new BadRequestException('At least one line is required');

    // Validate warehouses exist if provided
    if (dto.fromWarehouseId) {
      const w = await this.prisma.warehouse.findUnique({ where: { id: dto.fromWarehouseId } });
      if (!w || !w.isActive) throw new BadRequestException('Invalid fromWarehouseId');
    }
    if (dto.toWarehouseId) {
      const w = await this.prisma.warehouse.findUnique({ where: { id: dto.toWarehouseId } });
      if (!w || !w.isActive) throw new BadRequestException('Invalid toWarehouseId');
    }

    // Validate products/units exist and quantities > 0
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
      after: { id: created.id, documentNo: created.documentNo, type: created.type, status: created.status },
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
    if (move.status !== StockMoveStatus.DRAFT) throw new BadRequestException('Only DRAFT moves can be posted');

    await this.postingLock.assertPostingAllowed(
      actor,
      move.documentDate,
      `Inventory.postMove moveId=${move.id}`,
      overrideReason,
    );
    this.validateWarehouses(move.type, move.fromWarehouseId ?? undefined, move.toWarehouseId ?? undefined);

    // Validate stock availability for OUT movements (ISSUE, TRANSFER, ADJUSTMENT negative)
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

    // Transaction: create ledger entries + mark POSTED
    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.stockMove.findUnique({ where: { id } });
      if (!locked) throw new NotFoundException('StockMove not found');
      if (locked.status !== StockMoveStatus.DRAFT) throw new BadRequestException('Move already posted/canceled');

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

    // reversal uses opposite direction/warehouses depending on type
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
}
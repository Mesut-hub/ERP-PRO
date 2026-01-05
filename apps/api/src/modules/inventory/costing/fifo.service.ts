import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FifoService {
  constructor(private readonly prisma: PrismaService) {}

  async createInboundLayer(
    tx: PrismaService,
    args: {
    productId: string;
    warehouseId: string;
    sourceType: string;
    sourceId: string;
    sourceLineId?: string | null;
    receivedAt: Date;
    qtyIn: number;
    unitCostBase: number; // TRY
    },
  ) {
    if (args.qtyIn <= 0) throw new BadRequestException('qtyIn must be > 0');
    if (!Number.isFinite(args.unitCostBase) || args.unitCostBase <= 0) throw new BadRequestException('unitCostBase must be > 0');

    return (tx as any).inventoryFifoLayer.create({
      data: {
        productId: args.productId,
        warehouseId: args.warehouseId,
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        sourceLineId: args.sourceLineId ?? null,
        receivedAt: args.receivedAt,
        qtyIn: args.qtyIn.toFixed(4),
        qtyRemain: args.qtyIn.toFixed(4),
        unitCostBase: args.unitCostBase.toFixed(6),
      },
    });
  }

  /**
   * Allocate FIFO for an issue line.
   * Returns allocations and total amountBase (TRY).
   */
  async allocateOutbound(
    tx: PrismaService,
    args: {
    productId: string;
    warehouseId: string;
    issueSourceType: string;
    issueSourceId: string;
    issueSourceLineId?: string | null;
    qtyOut: number;
    },
  ) {
    if (args.qtyOut <= 0) throw new BadRequestException('qtyOut must be > 0');

    // NOTE: For full concurrency safety, we may need SELECT ... FOR UPDATE.
    // Prisma doesn't expose FOR UPDATE directly; we can use tx.$queryRaw later if needed.
    const layers = await (tx as any).inventoryFifoLayer.findMany({
      where: {
        productId: args.productId,
        warehouseId: args.warehouseId,
        qtyRemain: { gt: 0 },
      },
      orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
    });

    let remaining = args.qtyOut;
    const ops: any[] = [];
    let total = 0;

    for (const layer of layers) {
      if (remaining <= 0) break;

      const avail = Number(layer.qtyRemain);
      if (avail <= 0) continue;

      const take = Math.min(avail, remaining);
      const unitCost = Number(layer.unitCostBase);
      const amount = Math.round((take * unitCost + Number.EPSILON) * 100) / 100;

      total += amount;
      remaining -= take;

      ops.push(
        (tx as any).inventoryFifoAllocation.create({
          data: {
            productId: args.productId,
            warehouseId: args.warehouseId,
            issueSourceType: args.issueSourceType,
            issueSourceId: args.issueSourceId,
            issueSourceLineId: args.issueSourceLineId ?? null,
            layerId: layer.id,
            quantity: take.toFixed(4),
            unitCostBase: unitCost.toFixed(6),
            amountBase: amount.toFixed(2),
          },
        }),
      );

      const newRemain = avail - take;
      ops.push(
        (tx as any).inventoryFifoLayer.update({
          where: { id: layer.id },
          data: { qtyRemain: newRemain.toFixed(4) },
        }),
      );
    }

    if (remaining > 1e-9) {
      throw new BadRequestException(`Insufficient FIFO stock to allocate. Missing qty=${remaining.toFixed(4)}`);
    }

    await (tx as any).$transaction([ops]);

    return { totalAmountBase: Math.round((total + Number.EPSILON) * 100) / 100 };
  }
}
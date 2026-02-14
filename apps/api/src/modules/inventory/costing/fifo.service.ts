import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type FifoLayerRow = {
  id: string;
  qtyRemain: any;
  unitCostBase: any;
  receivedAt: Date;
  createdAt: Date;
};

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

      // valuation in base (TRY) - always required
      unitCostBase: number;

      // optional audit context for option (2)
      sourceCurrencyCode?: string | null;
      unitCostTxn?: number | null;
      fxRateToTry?: number | null;
    },
  ) {
    if (args.qtyIn <= 0) throw new BadRequestException('qtyIn must be > 0');
    if (!Number.isFinite(args.unitCostBase) || args.unitCostBase <= 0)
      throw new BadRequestException('unitCostBase must be > 0');

    const currency = args.sourceCurrencyCode?.toUpperCase().trim() || null;

    if (currency) {
      if (currency.length !== 3) throw new BadRequestException('sourceCurrencyCode must be 3 letters');
      if (args.unitCostTxn !== null && args.unitCostTxn !== undefined) {
        if (!Number.isFinite(args.unitCostTxn) || args.unitCostTxn <= 0)
          throw new BadRequestException('unitCostTxn must be > 0');
      }
      if (args.fxRateToTry !== null && args.fxRateToTry !== undefined) {
        if (!Number.isFinite(args.fxRateToTry) || args.fxRateToTry <= 0)
          throw new BadRequestException('fxRateToTry must be > 0');
      }
    }

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

        sourceCurrencyCode: currency,
        unitCostTxn:
          args.unitCostTxn === null || args.unitCostTxn === undefined
            ? null
            : args.unitCostTxn.toFixed(6),
        fxRateToTry:
          args.fxRateToTry === null || args.fxRateToTry === undefined
            ? null
            : args.fxRateToTry.toFixed(8),

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

    // LOCK candidate layers to prevent concurrent double-allocation
    const layers = await (tx as any).$queryRaw<FifoLayerRow[]>`
      SELECT "id", "qtyRemain", "unitCostBase", "receivedAt", "createdAt"
      FROM "InventoryFifoLayer"
      WHERE "productId" = ${args.productId}
        AND "warehouseId" = ${args.warehouseId}
        AND "qtyRemain" > 0
      ORDER BY "receivedAt" ASC, "createdAt" ASC
      FOR UPDATE
    `;

    let remaining = args.qtyOut;
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

      await (tx as any).inventoryFifoAllocation.create({
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
      });

      await (tx as any).inventoryFifoLayer.update({
        where: { id: layer.id },
        data: { qtyRemain: (avail - take).toFixed(4) },
      });
    }

    if (remaining > 1e-9) {
      throw new BadRequestException(`Insufficient FIFO stock. Missing qty=${remaining.toFixed(4)}`);
    }

    return { totalAmountBase: Math.round((total + Number.EPSILON) * 100) / 100 };
  }
}
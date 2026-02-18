import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function n(x: any) {
  const v = Number(x ?? 0);
  return Number.isFinite(v) ? v : 0;
}

async function main() {
  const deliveries = await prisma.salesDelivery.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      lines: true,
      so: { include: { lines: true } },
    },
  });

  let updated = 0;
  let skipped = 0;

  for (const d of deliveries) {
    // Only backfill those missing soLineId
    const targets = d.lines.filter((l) => !l.soLineId);
    if (targets.length === 0) {
      skipped++;
      continue;
    }

    // Track assigned qty per soLineId for this SO across deliveries processed so far:
    // We compute from DB to be safe.
    const assignedAgg = await prisma.salesDeliveryLine.groupBy({
      by: ['soLineId'],
      where: { delivery: { soId: d.soId }, soLineId: { not: null } },
      _sum: { quantity: true },
    });

    const assignedBySoLineId = new Map<string, number>();
    for (const a of assignedAgg) {
      if (a.soLineId) assignedBySoLineId.set(a.soLineId, n(a._sum.quantity));
    }

    // SO lines by (productId, unitId)
    const candidatesByKey = new Map<string, any[]>();
    for (const sol of d.so.lines) {
      const key = `${sol.productId}:${sol.unitId}`;
      const arr = candidatesByKey.get(key) ?? [];
      arr.push(sol);
      candidatesByKey.set(key, arr);
    }

    for (const dl of targets) {
      const key = `${dl.productId}:${dl.unitId}`;
      const cands = candidatesByKey.get(key) ?? [];

      if (cands.length === 0) continue;

      // choose a candidate with remaining capacity
      const qty = n(dl.quantity);
      let chosen: any | null = null;

      for (const sol of cands) {
        const ordered = n(sol.quantity);
        const alreadyAssigned = assignedBySoLineId.get(sol.id) ?? 0;
        const remaining = ordered - alreadyAssigned;

        if (remaining >= qty - 1e-9) {
          chosen = sol;
          break;
        }
      }

      // fallback: first candidate (better than leaving null)
      if (!chosen) chosen = cands[0];

      await prisma.salesDeliveryLine.update({
        where: { id: dl.id },
        data: { soLineId: chosen.id },
      });

      assignedBySoLineId.set(chosen.id, (assignedBySoLineId.get(chosen.id) ?? 0) + qty);
      updated++;
    }
  }

  console.log({ deliveries: deliveries.length, updated, skipped });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
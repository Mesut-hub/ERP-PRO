import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

function parseAsOf(asOf?: string) {
  const d = asOf ? new Date(asOf) : new Date();
  if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid asOf date');
  d.setHours(23, 59, 59, 999);
  return d;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- AR ----------
  async arOpenInvoices(customerId?: string) {
    const invoices = await this.prisma.customerInvoice.findMany({
      where: {
        status: 'POSTED',
        customerId: customerId ?? undefined,
      },
      include: { customer: true },
      orderBy: { documentDate: 'asc' },
      take: 500,
    });

    // allocations (sum) per invoice
    const alloc = await this.prisma.paymentAllocation.groupBy({
      by: ['customerInvoiceId'],
      where: {
        customerInvoiceId: { not: null },
        payment: { status: 'POSTED' }, // only posted payments reduce open balance
      },
      _sum: { amount: true },
    });

    const paidByInvoice = new Map<string, number>();
    for (const a of alloc) {
      if (a.customerInvoiceId) paidByInvoice.set(a.customerInvoiceId, Number(a._sum.amount ?? 0));
    }

    const rows = invoices
      .map((inv) => {
        const paid = paidByInvoice.get(inv.id) ?? 0;
        const open = Number(inv.grandTotal) - paid;
        return {
          invoiceId: inv.id,
          documentNo: inv.documentNo,
          documentDate: inv.documentDate,
          customerId: inv.customerId,
          customerName: inv.customer.name,
          currencyCode: inv.currencyCode,
          grandTotal: Number(inv.grandTotal).toFixed(2),
          paidTotal: paid.toFixed(2),
          openTotal: open.toFixed(2),
        };
      })
      .filter((r) => Number(r.openTotal) > 0.005);

    return rows;
  }

  async arAging(customerId?: string, asOf?: string) {
    const asOfDate = parseAsOf(asOf);

    const invoices = await this.prisma.customerInvoice.findMany({
      where: {
        status: 'POSTED',
        customerId: customerId ?? undefined,
      },
      include: { customer: true },
      orderBy: { documentDate: 'asc' },
      take: 1000,
    });

    const alloc = await this.prisma.paymentAllocation.groupBy({
      by: ['customerInvoiceId'],
      where: {
        customerInvoiceId: { not: null },
        payment: { status: 'POSTED', documentDate: { lte: asOfDate } },
      },
      _sum: { amount: true },
    });

    const paidByInvoice = new Map<string, number>();
    for (const a of alloc) {
      if (a.customerInvoiceId) paidByInvoice.set(a.customerInvoiceId, Number(a._sum.amount ?? 0));
    }

    const buckets = {
      current: 0,
      d0_30: 0,
      d31_60: 0,
      d61_90: 0,
      d90_plus: 0,
    };

    const details: any[] = [];

    for (const inv of invoices) {
      const paid = paidByInvoice.get(inv.id) ?? 0;
      const open = Number(inv.grandTotal) - paid;
      if (open <= 0.005) continue;

      const terms = inv.customer.paymentTermsDays ?? 0;
      const dueDate = addDays(inv.documentDate, terms);

      const daysPastDue = Math.floor((asOfDate.getTime() - dueDate.getTime()) / (24 * 3600 * 1000));

      let bucket = 'current';
      if (daysPastDue <= 0) bucket = 'current';
      else if (daysPastDue <= 30) bucket = 'd0_30';
      else if (daysPastDue <= 60) bucket = 'd31_60';
      else if (daysPastDue <= 90) bucket = 'd61_90';
      else bucket = 'd90_plus';

      (buckets as any)[bucket] += open;

      details.push({
        invoiceId: inv.id,
        documentNo: inv.documentNo,
        customerId: inv.customerId,
        customerName: inv.customer.name,
        currencyCode: inv.currencyCode,
        documentDate: inv.documentDate,
        dueDate,
        daysPastDue,
        openTotal: open.toFixed(2),
        bucket,
      });
    }

    return {
      asOf: asOfDate.toISOString(),
      customerId: customerId ?? null,
      totals: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.toFixed(2)])),
      details,
    };
  }

  // ---------- AP ----------
  async apOpenInvoices(supplierId?: string) {
    const invoices = await this.prisma.supplierInvoice.findMany({
      where: { status: 'POSTED', supplierId: supplierId ?? undefined },
      include: { supplier: true },
      orderBy: { documentDate: 'asc' },
      take: 500,
    });

    const alloc = await this.prisma.paymentAllocation.groupBy({
      by: ['supplierInvoiceId'],
      where: {
        supplierInvoiceId: { not: null },
        payment: { status: 'POSTED' },
      },
      _sum: { amount: true },
    });

    const paidByInvoice = new Map<string, number>();
    for (const a of alloc) {
      if (a.supplierInvoiceId) paidByInvoice.set(a.supplierInvoiceId, Number(a._sum.amount ?? 0));
    }

    const rows = invoices
      .map((inv) => {
        const paid = paidByInvoice.get(inv.id) ?? 0;
        const open = Number(inv.grandTotal) - paid;
        return {
          invoiceId: inv.id,
          documentNo: inv.documentNo,
          documentDate: inv.documentDate,
          supplierId: inv.supplierId,
          supplierName: inv.supplier.name,
          currencyCode: inv.currencyCode,
          grandTotal: Number(inv.grandTotal).toFixed(2),
          paidTotal: paid.toFixed(2),
          openTotal: open.toFixed(2),
        };
      })
      .filter((r) => Number(r.openTotal) > 0.005);

    return rows;
  }

  async apAging(supplierId?: string, asOf?: string) {
    const asOfDate = parseAsOf(asOf);

    const invoices = await this.prisma.supplierInvoice.findMany({
      where: { status: 'POSTED', supplierId: supplierId ?? undefined },
      include: { supplier: true },
      orderBy: { documentDate: 'asc' },
      take: 1000,
    });

    const alloc = await this.prisma.paymentAllocation.groupBy({
      by: ['supplierInvoiceId'],
      where: {
        supplierInvoiceId: { not: null },
        payment: { status: 'POSTED', documentDate: { lte: asOfDate } },
      },
      _sum: { amount: true },
    });

    const paidByInvoice = new Map<string, number>();
    for (const a of alloc) {
      if (a.supplierInvoiceId) paidByInvoice.set(a.supplierInvoiceId, Number(a._sum.amount ?? 0));
    }

    const buckets = {
      current: 0,
      d0_30: 0,
      d31_60: 0,
      d61_90: 0,
      d90_plus: 0,
    };

    const details: any[] = [];

    for (const inv of invoices) {
      const paid = paidByInvoice.get(inv.id) ?? 0;
      const open = Number(inv.grandTotal) - paid;
      if (open <= 0.005) continue;

      const terms = inv.supplier.paymentTermsDays ?? 0;
      const dueDate = addDays(inv.documentDate, terms);

      const daysPastDue = Math.floor((asOfDate.getTime() - dueDate.getTime()) / (24 * 3600 * 1000));

      let bucket = 'current';
      if (daysPastDue <= 0) bucket = 'current';
      else if (daysPastDue <= 30) bucket = 'd0_30';
      else if (daysPastDue <= 60) bucket = 'd31_60';
      else if (daysPastDue <= 90) bucket = 'd61_90';
      else bucket = 'd90_plus';

      (buckets as any)[bucket] += open;

      details.push({
        invoiceId: inv.id,
        documentNo: inv.documentNo,
        supplierId: inv.supplierId,
        supplierName: inv.supplier.name,
        currencyCode: inv.currencyCode,
        documentDate: inv.documentDate,
        dueDate,
        daysPastDue,
        openTotal: open.toFixed(2),
        bucket,
      });
    }

    return {
      asOf: asOfDate.toISOString(),
      supplierId: supplierId ?? null,
      totals: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.toFixed(2)])),
      details,
    };
  }
}

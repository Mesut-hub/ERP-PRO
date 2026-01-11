import { BadRequestException } from '@nestjs/common';

export function sumInvoice(lines: Array<{ quantity: any; unitPrice: any; vatRate: number }>) {
  let net = 0;
  let vat = 0;

  for (const l of lines) {
    const qty = Number(l.quantity);
    const price = Number(l.unitPrice);
    if (qty <= 0 || price < 0) throw new BadRequestException('Invalid invoice line amounts');
    const lineNet = qty * price;
    const lineVat = lineNet * (l.vatRate / 100);
    net += lineNet;
    vat += lineVat;
  }

  const total = net + vat;
  return { net, vat, total };
}

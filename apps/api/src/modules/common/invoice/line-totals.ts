export function computeLineTotals(quantity: number, unitPrice: number, vatRate: number) {
  const lineSubtotal = quantity * unitPrice;
  const lineVat = lineSubtotal * (vatRate / 100);
  const lineTotal = lineSubtotal + lineVat;

  // Keep numeric; Prisma Decimal columns accept number/string
  return {
    lineSubtotal: lineSubtotal.toFixed(2),
    lineVat: lineVat.toFixed(2),
    lineTotal: lineTotal.toFixed(2),
  };
}

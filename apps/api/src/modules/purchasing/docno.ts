function ymd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function formatPoNo(date: Date, seq: number) {
  return `PO-${ymd(date)}-${String(seq).padStart(4, '0')}`;
}

export function formatGrnNo(date: Date, seq: number) {
  return `GRN-${ymd(date)}-${String(seq).padStart(4, '0')}`;
}

export function formatSupplierInvNo(date: Date, seq: number) {
  return `SI-${ymd(date)}-${String(seq).padStart(4, '0')}`;
}

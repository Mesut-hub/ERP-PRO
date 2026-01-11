export function formatStockMoveDocNo(date: Date, seq: number) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `SM-${y}${m}${d}-${String(seq).padStart(4, '0')}`;
}
